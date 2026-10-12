import { Prisma, db, type BankAccount } from "@workspace/db";
import { ApiError, audit, type Actor } from "./core";
import { decryptCredentials, digest, encryptCredentials } from "./integrations/security";
import { generateNcbaCredentials, NCBA_TILL_PAYBILL, readableSecret } from "./integrations/ncba";
import { kcbPublicKey } from "./integrations/kcb";
import { callbackBase } from "./integrations/daraja";

/** Banks with a live connection to Rejista. More are added as each bank's API is integrated. */
export const BANKS: Record<string, string> = { ncba: "NCBA", kcb: "KCB" };

/** How parents pay into each bank's account. KCB's till notifications are keyed by a business key KCB confirms. */
const COLLECTION_TYPES: Record<string, string[]> = { ncba: ["ncba_till", "paybill"], kcb: ["kcb_till"] };
export type BankAccountInput = { bank: string; accountName: string; accountNumber: string; branch?: string | null; collectionType?: string | null; collectionNumber?: string | null };

/** Never returns credentials or the callback token hash. */
export const bankAccountView = (a: BankAccount) => ({
  id: a.id, bank: a.bank, accountName: a.accountName, accountNumber: a.accountNumber, branch: a.branch,
  collectionType: a.collectionType, collectionNumber: a.collectionNumber, notificationStatus: a.notificationStatus,
  signingKeySaved: a.bank === "kcb" && !!a.encryptedCredentials && !!decryptCredentials(a.encryptedCredentials).kcbPublicKey,
  requestedAt: a.requestedAt, liveAt: a.liveAt, lastNotificationAt: a.lastNotificationAt, createdAt: a.createdAt,
});

function clean(input: BankAccountInput) {
  if (!BANKS[input.bank]) throw new ApiError(400, "Choose a bank from the list");
  const collectionType = input.collectionType ?? null, collectionNumber = input.collectionNumber?.trim() || null;
  if (collectionType && !COLLECTION_TYPES[input.bank].includes(collectionType)) throw new ApiError(400, "That way of paying doesn't apply to this bank");
  if (!collectionType !== !collectionNumber) throw new ApiError(400, input.bank === "kcb" ? "Enter the till business key, or leave it empty for account payments only" : "Choose how parents pay and enter the till or paybill number");
  if (collectionType === "ncba_till" && collectionNumber === NCBA_TILL_PAYBILL) throw new ApiError(400, `${NCBA_TILL_PAYBILL} is NCBA's paybill. Enter your school's own NCBA Till number`);
  return { bank: input.bank, accountName: input.accountName.trim(), accountNumber: input.accountNumber.trim(), branch: input.branch?.trim() || null, collectionType, collectionNumber };
}

async function unique<T>(run: () => Promise<T>) {
  try { return await run(); } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const target = String(error.meta?.target ?? "");
      throw new ApiError(409, target.includes("accountNumber") ? "This account is already registered to a school on Rejista" : "This till is already registered to a school on Rejista");
    }
    throw error;
  }
}

async function owned(actor: Actor, id: string) {
  const account = await db.bankAccount.findFirst({ where: { id, schoolId: actor.school.id } });
  if (!account) throw new ApiError(404, "Bank account not found");
  return account;
}

export async function listBankAccounts(actor: Actor) {
  return (await db.bankAccount.findMany({ where: { schoolId: actor.school.id }, orderBy: { createdAt: "asc" } })).map(bankAccountView);
}

export async function createBankAccount(actor: Actor, input: BankAccountInput) {
  const data = clean(input);
  return bankAccountView(await unique(() => db.$transaction(async tx => {
    const account = await tx.bankAccount.create({ data: { ...data, schoolId: actor.school.id } });
    await audit(tx, actor, "created", "bank_account", account.id, undefined, data);
    return account;
  })));
}

export async function updateBankAccount(actor: Actor, id: string, input: BankAccountInput) {
  const before = await owned(actor, id), data = clean(input);
  if (data.bank !== before.bank) throw new ApiError(400, "Remove the account and add it again to change the bank");
  // NCBA's letter carries the numbers, so they lock once it is issued; KCB routes by them, so they lock once live.
  const lockedNumbers = before.bank === "ncba" ? before.notificationStatus !== "off" : before.notificationStatus === "live";
  if (lockedNumbers && (data.collectionType !== before.collectionType || data.collectionNumber !== before.collectionNumber || data.accountNumber !== before.accountNumber)) {
    throw new ApiError(409, `${BANKS[before.bank]} has been asked to send notifications for this account. Remove it and add it again to change the account or till.`);
  }
  return bankAccountView(await unique(() => db.$transaction(async tx => {
    const account = await tx.bankAccount.update({ where: { id }, data });
    await audit(tx, actor, "updated", "bank_account", id, bankAccountView(before), data);
    return account;
  })));
}

export async function deleteBankAccount(actor: Actor, id: string) {
  const before = await owned(actor, id);
  await db.$transaction(async tx => {
    await tx.bankAccount.delete({ where: { id } });
    await audit(tx, actor, "deleted", "bank_account", id, bankAccountView(before), undefined);
  });
}

function publicBase() {
  try { return callbackBase(); }
  catch { throw new ApiError(503, "Rejista's public web address is not set up on this server yet, so the bank details can't be made. Contact Rejista support."); }
}

/**
 * Issues fresh NCBA credentials for the request letter. They are returned once and stored encrypted; asking
 * again replaces them, so the account goes back to "requested" until NCBA uses the new ones.
 */
export async function requestNcba(actor: Actor, id: string) {
  const account = await owned(actor, id);
  if (account.bank !== "ncba" || !account.collectionType || !account.collectionNumber) throw new ApiError(400, "Add the NCBA till or paybill number to this account first");
  const endpointBase = `${publicBase()}/api/integrations/ncba/notification/`;
  const { callbackToken, ...credentials } = generateNcbaCredentials();
  await db.$transaction(async tx => {
    await tx.bankAccount.update({ where: { id }, data: {
      encryptedCredentials: encryptCredentials(credentials), callbackTokenHash: digest(callbackToken),
      notificationStatus: "requested", requestedAt: new Date(), liveAt: null,
    } });
    await audit(tx, actor, "ncba_credentials_issued", "bank_account", id, { notificationStatus: account.notificationStatus }, { notificationStatus: "requested" });
  });
  return {
    schoolName: actor.school.name, accountName: account.accountName, accountNumber: account.accountNumber, branch: account.branch,
    collectionType: account.collectionType, collectionNumber: account.collectionNumber, endpointUrl: endpointBase + callbackToken, ...credentials,
  };
}

/** The NCBA account a notification URL belongs to, with its decrypted credentials. */
export async function ncbaAccountForToken(token: string) {
  const account = await db.bankAccount.findUnique({ where: { callbackTokenHash: digest(token) } });
  if (!account || account.bank !== "ncba" || account.notificationStatus === "off" || !account.encryptedCredentials || !account.collectionType || !account.collectionNumber) {
    throw new ApiError(404, "NCBA notification route not found");
  }
  return { account, credentials: decryptCredentials(account.encryptedCredentials) };
}

/**
 * The service provider named on KCB's request letter: Regginna Technology Services, the company behind Rejista.
 * Each value can be overridden with a PROVIDER_* setting.
 */
export function kcbProvider() {
  return {
    businessName: process.env.PROVIDER_BUSINESS_NAME?.trim() || "Regginna Technology Services",
    contactName: process.env.PROVIDER_CONTACT_NAME?.trim() || "Fredrick Mundia Githumbi",
    email: process.env.PROVIDER_CONTACT_EMAIL?.trim() || "githumbi3fred@gmail.com",
    phone: process.env.PROVIDER_CONTACT_PHONE?.trim() || "0715 363 474",
  };
}

/** The account a KCB request is about. */
export async function kcbAccount(actor: Actor, id: string) {
  const account = await owned(actor, id);
  if (account.bank !== "kcb") throw new ApiError(400, "This is not a KCB account");
  return account;
}

function kcbUrls(account: BankAccount, token: string) {
  let base: string;
  try { base = `${callbackBase()}/api/integrations/kcb`; } catch { return { accountNotificationUrl: null, tillNotificationUrl: null }; }
  return {
    accountNotificationUrl: `${base}/account-notification/${token}`,
    tillNotificationUrl: account.collectionType === "kcb_till" ? `${base}/till-notification/${token}` : null,
  };
}

/** Gives the account a fresh token. It is kept encrypted (as well as hashed) so the addresses can be shown again. */
async function issueKcbToken(actor: Actor, account: BankAccount, replacing: boolean) {
  const token = readableSecret(40);
  const credentials = account.encryptedCredentials ? decryptCredentials(account.encryptedCredentials) : {};
  await db.$transaction(async tx => {
    await tx.bankAccount.update({ where: { id: account.id }, data: {
      encryptedCredentials: encryptCredentials({ ...credentials, callbackToken: token }), callbackTokenHash: digest(token),
      notificationStatus: "requested", requestedAt: new Date(), liveAt: null,
    } });
    await audit(tx, actor, replacing ? "kcb_address_replaced" : "kcb_address_issued", "bank_account", account.id, { notificationStatus: account.notificationStatus }, { notificationStatus: "requested" });
  });
  return token;
}

/**
 * The addresses KCB sends this account's payments to, made the first time they are asked for. Both the account and
 * the till address carry the same token; the path says which kind of notification it is.
 */
export async function kcbConnection(actor: Actor, id: string) {
  const account = await kcbAccount(actor, id);
  const stored = account.encryptedCredentials ? decryptCredentials(account.encryptedCredentials).callbackToken : undefined;
  const token = stored && account.callbackTokenHash === digest(stored) ? stored : await issueKcbToken(actor, account, false);
  return { ...kcbUrls(account, token), emailTo: "buni@kcbgroup.com" };
}

/** New addresses for a KCB account; the old ones stop working at once. */
export async function replaceKcbAddresses(actor: Actor, id: string) {
  const account = await kcbAccount(actor, id);
  return { ...kcbUrls(account, await issueKcbToken(actor, account, true)), emailTo: "buni@kcbgroup.com" };
}

/** Optional per-account override of KCB's signing key, for the case where KCB issues different keys. Stored encrypted. */
export async function saveKcbKey(actor: Actor, id: string, publicKey: string) {
  const account = await kcbAccount(actor, id);
  kcbPublicKey(publicKey.trim());
  const credentials = account.encryptedCredentials ? decryptCredentials(account.encryptedCredentials) : {};
  const updated = await db.$transaction(async tx => {
    const row = await tx.bankAccount.update({ where: { id }, data: { encryptedCredentials: encryptCredentials({ ...credentials, kcbPublicKey: publicKey.trim() }) } });
    await audit(tx, actor, "kcb_signing_key_saved", "bank_account", id, { signingKeySaved: !!credentials.kcbPublicKey }, { signingKeySaved: true });
    return row;
  });
  return bankAccountView(updated);
}

/**
 * KCB signs every notification with its own key, the same for all its partners, so Rejista keeps it once in
 * KCB_PUBLIC_KEY. Accepted forms, all on one line: the full PEM with "\n" escapes (optionally quoted), or just the
 * base64 body, which is wrapped into a PEM here. A key saved on an account overrides it.
 */
export function platformKcbKey() {
  const value = process.env.KCB_PUBLIC_KEY?.trim().replace(/^"(.*)"$/s, "$1").replace(/\\n/g, "\n").trim();
  if (!value) return undefined;
  if (value.includes("BEGIN")) return value;
  const body = value.replace(/\s+/g, "");
  return `-----BEGIN PUBLIC KEY-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END PUBLIC KEY-----`;
}

/** The KCB account a notification URL belongs to, if it is a Bank-tab account rather than a legacy integration. */
export async function kcbAccountForToken(token: string) {
  const account = await db.bankAccount.findUnique({ where: { callbackTokenHash: digest(token) } });
  if (!account || account.bank !== "kcb") return null;
  if (account.notificationStatus === "off") throw new ApiError(404, "KCB callback configuration not found");
  const key = (account.encryptedCredentials ? decryptCredentials(account.encryptedCredentials).kcbPublicKey : undefined) ?? platformKcbKey();
  if (!key) throw new ApiError(503, "KCB signing public key is not configured");
  return { account, kcbPublicKey: key };
}
