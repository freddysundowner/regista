import bcrypt from "bcryptjs";
import { createHash } from "node:crypto";
// bcrypt has a 72-byte input limit. Prehashing preserves the contract's full
// 128-character passwords, including Unicode, without truncation.
const material = (password: string) => createHash("sha384").update("school-password-v1\0").update(password).digest("base64");
export const hashPassword = (password: string) => bcrypt.hash(material(password), 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(material(password), hash);