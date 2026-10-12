// Prints a new Ed25519 key pair for standalone licences.
// LICENCE_SIGNING_KEY goes only on the hosted server (keep it secret);
// LICENCE_PUBLIC_KEY goes on every licensed standalone install.
import { generateKeyPairSync } from "node:crypto";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
console.log(`LICENCE_SIGNING_KEY=${privateKey.export({ format: "der", type: "pkcs8" }).toString("base64")}`);
console.log(`LICENCE_PUBLIC_KEY=${publicKey.export({ format: "der", type: "spki" }).toString("base64")}`);
