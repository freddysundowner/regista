# NCBA payment notifications

Sources: *NCBA Paybill-Level Push Notifications Service Guide* (2023), *NCBA Till STK Push & Dynamic QR Code
API* (2024) and NCBA's *STK and API Push Request Letter* template, all supplied by NCBA.

## How a school connects

1. `APP_BASE_URL` must be the published app's public HTTPS origin. It is printed on the letter as the
   notification endpoint, so set it before any school requests a letter.
2. In **Settings → Bank → Add bank**, the school picks NCBA and enters the account name, number, branch, and how
   parents pay: an **NCBA Till** (paid through paybill 880100) or its **own paybill**. Buy goods tills are not offered:
   M-Pesa gives the parent no field for the admission number, so payments can't be matched automatically.
3. **Get request letter** generates the notification username, password and secret key, plus an STK username
   and secret key. NCBA leaves the choice of these to the merchant. They are stored encrypted and shown **once**,
   filled into NCBA's letter template. The school prints it on its letterhead, signs it and takes it to its branch.
4. The account shows **Waiting for NCBA** until the first notification arrives with a correct hash. It then turns
   **Live** by itself. A new letter replaces all the credentials and sets the account back to waiting.

Each school has its own endpoint token and credentials. One NCBA till or paybill can belong to only one school,
which a unique index enforces, so a notification can never be credited to another tenant.

## Notification handling

`POST /api/integrations/ncba/notification/{token}`, JSON only.

- **Authentication:** `Username` and `Password` must match exactly, otherwise the request gets 401. `Hash` is checked as
  `base64(lowercase-hex(sha256(secretKey + TransType + TransID + TransTime + TransAmount + BusinessShortCode +
  BillRefNumber + Mobile + name + "1")))`, following NCBA's Java sample. When the username and password are correct but the hash
  is not, the payment is **kept but held** (`callback_hold`, so the bursar confirms it in Unmatched) and a
  `hash_mismatch` event is logged. The recipe hasn't been confirmed against a live message yet, and refusing
  could lose a payment the parent has already made.
- **Routing:** for an NCBA Till the message must carry `BusinessShortCode` 880100 and the school's till number in
  `BillRefNumber`. For an own paybill, `BusinessShortCode` must be the school's number. Anything else is refused with 403.
- **Reference (admission number):** NCBA Till uses `Narrative`, own paybill uses `BillRefNumber`. `N/A` counts as empty. A 64-character hex `Mobile` is NCBA's hashed number
  and is not stored as the payer's phone.
- **Time:** `TransTime` is `YYYYMMDDhhmmss` in Nairobi time. Impossible or future times are refused.
- **Identity:** the payment is recorded as `(school, provider=ncba, TransID)`. Repeats are acknowledged without a second credit,
  and an altered amount or reference conflicts. The usual high-value and late-payment hold applies.
- **Storage:** the stored raw payload never includes `Username`, `Password` or `Hash`.
- **Replies:** `{"ResultCode":"0"}` means the payment was stored durably, not that it was allocated. Refusals reply with
  `{"ResultCode":"1"}` and the matching HTTP status, and are logged as `notification_refused`.

## Still to confirm with NCBA

1. Retries: are failed or unanswered notifications resent, how often, and for how long?
2. The hash: is `CreditAccount` in the sample `BusinessShortCode`? Is `Narrative` included for NCBA Till? Ask for a
   real sample message with its secret key so it can become a test.
3. Is `Mobile` hashed for our account?
4. Source IP ranges to allowlist.
5. Is there a test environment? The token call is `GET` in the STK section and `POST` in the QR section; which is right?
6. For STK push on an NCBA Till, what goes in `AccountNo` so the admission number reaches `Narrative`?
7. Can one platform-wide endpoint and set of credentials serve many schools, as NCBA appears to do for Mzizi?

## Not built yet

STK push and dynamic QR codes. Their credentials are already issued on the letter. Banks other than NCBA and
KCB store account details only, and their payments are matched from uploaded statements.
