import { Router } from "express";
import * as schemas from "@workspace/api-zod";
import { allow, admin, body } from "../lib/core";
import { createBankAccount, deleteBankAccount, kcbConnection, listBankAccounts, replaceKcbAddresses, requestNcba, saveKcbKey, updateBankAccount } from "../lib/bank-accounts";
import { kcbLetterPdf } from "../lib/bank-letters";

const router = Router();
router.get("/bank-accounts", async (req, res) => { allow(req, admin); res.json(await listBankAccounts(req.actor)); });
router.post("/bank-accounts", async (req, res) => { allow(req, admin); res.json(await createBankAccount(req.actor, body(schemas.CreateBankAccountBody, req.body))); });
router.patch("/bank-accounts/:id", async (req, res) => { allow(req, admin); res.json(await updateBankAccount(req.actor, String(req.params.id), body(schemas.UpdateBankAccountBody, req.body))); });
router.delete("/bank-accounts/:id", async (req, res) => { allow(req, admin); await deleteBankAccount(req.actor, String(req.params.id)); res.sendStatus(204); });
router.post("/bank-accounts/:id/ncba-request", async (req, res) => { allow(req, admin); res.json(await requestNcba(req.actor, String(req.params.id))); });
router.get("/bank-accounts/:id/kcb", async (req, res) => { allow(req, admin); res.json(await kcbConnection(req.actor, String(req.params.id))); });
router.post("/bank-accounts/:id/kcb", async (req, res) => { allow(req, admin); res.json(await replaceKcbAddresses(req.actor, String(req.params.id))); });
router.get("/bank-accounts/:id/kcb-letter.pdf", async (req, res) => {
  allow(req, admin);
  const { bytes, filename } = await kcbLetterPdf(req.actor, String(req.params.id));
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" }).send(bytes);
});
router.put("/bank-accounts/:id/kcb-key", async (req, res) => { allow(req, admin); res.json(await saveKcbKey(req.actor, String(req.params.id), body(schemas.SaveKcbSigningKeyBody, req.body).publicKey)); });
export default router;
