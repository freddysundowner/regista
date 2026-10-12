import { writeFileSync } from "node:fs";
const string = { type: "string" }, uuid = { type: "string", format: "uuid" };
const date = { type: "string", format: "date" }, instant = { type: "string", format: "date-time" };
const number = { type: "number" }, boolean = { type: "boolean" };
const money = { type: "string", pattern: "^\\d{1,12}(\\.\\d{1,2})?$" };
const en = (...values) => ({ type: "string", enum: values });
const arr = items => ({ type: "array", items });
const obj = (properties, required = []) => ({ type: "object", properties, required });
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const schemas = {
  IntegrationInput: obj({ provider: en("daraja", "leadsintel", "africastalking", "bot", "bank"), environment: en("sandbox", "production"), enabled: boolean, credentials: { type: "object", additionalProperties: { type: "string" }, description: "Write-only encrypted values. ENCRYPTION_KEY required; never returned." }, shortcode: string, accountNumber: string, connectionId: string }, ["provider", "environment", "enabled", "credentials"]),
  IntegrationStatus: obj({ provider: string, environment: string, enabled: boolean, configured: boolean, status: string, reason: string }, ["provider", "enabled", "configured", "status"]),
  IncomingInput: obj({ provider: string, providerTxnId: string, channel: en("mpesa_c2b", "mpesa_stk", "bank"), amount: money, transactionTime: instant, payerPhone: string, payerName: string, accountReference: string, bankAccountFrom: string, knownStudentId: uuid }, ["provider", "providerTxnId", "channel", "amount", "transactionTime"]),
  IncomingPaymentView: obj({ id: uuid, provider: string, providerTxnId: string, channel: string, amount: money, transactionTime: instant, payerPhone: string, payerName: string, accountReference: string, status: string, duplicateOfId: string }, ["id", "provider", "providerTxnId", "channel", "amount", "status"]),
  MatchCandidate: obj({ studentId: uuid, score: number, reasons: arr(string) }, ["studentId", "score", "reasons"]),
  ExceptionView: obj({ id: uuid, paymentId: uuid, reason: string, status: string, candidates: arr(ref("MatchCandidate")), createdAt: instant, expiresAt: instant }, ["id", "paymentId", "reason", "status", "candidates", "createdAt"]),
  StudentSplit: obj({ studentId: uuid, amount: money }, ["studentId", "amount"]),
  ResolutionInput: obj({ action: en("assign", "split", "suspense", "refund"), allocations: arr(ref("StudentSplit")), reason: string, learnAlias: boolean }, ["action", "reason"]),
  StkInput: obj({ studentId: uuid, phone: string, amount: money, idempotencyKey: string }, ["studentId", "phone", "amount", "idempotencyKey"]),
  StkView: obj({ id: uuid, studentId: uuid, amount: money, status: string, checkoutRequestId: string, resultCode: string }, ["id", "studentId", "amount", "status"]),
  StatementInput: obj({ provider: string, fromDate: instant, toDate: instant, rows: arr(ref("IncomingInput")), completeStatement: boolean }, ["provider", "fromDate", "toDate", "rows", "completeStatement"]),
  StatementFileInput: obj({ provider: string, format: en("csv", "xlsx", "mt940"), content: string, mapping: obj({ providerTxnId: string, amount: string, transactionTime: string, accountReference: string, payerPhone: string, payerName: string }, ["providerTxnId", "amount", "transactionTime"]) }, ["provider", "format", "content"]),
  StatementPreview: obj({ rows: arr(ref("IncomingInput")), errors: arr(obj({ row: number, message: string }, ["row", "message"])) }, ["rows", "errors"]),
  ReconView: obj({ id: uuid, provider: string, status: string, statementCount: number, systemCount: number, statementTotal: money, systemTotal: money, discrepancies: arr(obj({ type: string, providerTxnId: string, detail: string }, ["type", "providerTxnId"])), createdAt: instant }, ["id", "provider", "status", "statementCount", "systemCount", "statementTotal", "systemTotal", "discrepancies"]),
  SponsorInput: obj({ paymentId: uuid, sponsorId: uuid, type: en("bursary", "sponsorship"), allocations: arr(ref("StudentSplit")), remainderReason: string, reason: string }, ["paymentId", "sponsorId", "type", "allocations", "reason"]),
  PlanInstallmentInput: obj({ dueDate: date, amount: money }, ["dueDate", "amount"]),
  PlanInput: obj({ studentId: uuid, termId: uuid, installments: arr(ref("PlanInstallmentInput")) }, ["studentId", "termId", "installments"]),
  PlanView: obj({ id: uuid, studentId: uuid, termId: uuid, totalAmount: money, status: string, requestedVia: string, installments: arr(obj({ id: uuid, dueDate: date, amount: money, amountPaid: money, status: string }, ["id", "dueDate", "amount", "amountPaid", "status"])) }, ["id", "studentId", "termId", "totalAmount", "status", "installments"]),
  DecisionInput: obj({ decision: en("approved", "rejected"), reason: string }, ["decision", "reason"]),
  ActionResult: obj({ id: string, status: string, message: string }, ["status"]),
  BotIdentityInput: obj({ phone: string }, ["phone"]),
  BotOtpInput: obj({ phone: string, code: { type: "string", pattern: "^\\d{6}$" } }, ["phone", "code"]),
  BotIdentityView: obj({ guardianId: uuid, children: arr(obj({ id: uuid, name: string, admissionNo: string, grade: string }, ["id", "name", "admissionNo"])) }, ["guardianId", "children"]),
  MessageInput: obj({ guardianId: uuid, template: string, content: string, idempotencyKey: string, channel: en("whatsapp", "sms") }, ["guardianId", "template", "content", "idempotencyKey", "channel"]),
  MessageView: obj({ id: uuid, guardianId: uuid, channel: string, template: string, status: string, attempts: number, error: string, providerMessageId: string }, ["id", "channel", "template", "status", "attempts"]),
  CurriculumInput: obj({ kind: en("learning_area", "strand", "sub_strand", "scale", "grade_scale", "assignment"), name: string, code: string, gradeId: uuid, learningAreaId: uuid, parentId: uuid, order: number, scaleId: uuid, userId: uuid, streamId: uuid, termId: uuid, levels: arr(obj({ code: string, label: string, points: money, minPercent: money, maxPercent: money, order: number }, ["code", "label", "points", "minPercent", "maxPercent", "order"])) }, ["kind"]),
  CurriculumView: obj({
    learningAreas: arr(obj({ id: uuid, gradeId: uuid, name: string, code: string, isCore: boolean, pathway: { type: "string", nullable: true } }, ["id", "gradeId", "name", "code"])),
    strands: arr(obj({ id: uuid, learningAreaId: uuid, parentId: string, name: string, order: number }, ["id", "learningAreaId", "name", "order"])),
    scales: arr(obj({ id: uuid, name: string, levels: arr(obj({ id: uuid, code: string, label: string, points: money, minPercent: money, maxPercent: money, order: number }, ["id", "code", "label", "points", "minPercent", "maxPercent", "order"])) }, ["id", "name", "levels"])),
    gradeScales: arr(obj({ gradeId: uuid, scaleId: uuid }, ["gradeId", "scaleId"])),
    assignments: arr(obj({ id: uuid, userId: uuid, streamId: uuid, learningAreaId: uuid, termId: uuid }, ["id", "userId", "streamId", "learningAreaId", "termId"])),
  }, ["learningAreas", "strands", "scales", "gradeScales", "assignments"]),
  AssessmentInput: obj({ termId: uuid, gradeId: uuid, learningAreaId: uuid, name: string, type: en("formative", "summative", "project", "sba"), maxMarks: money, weight: money, date }, ["termId", "gradeId", "learningAreaId", "name", "type", "weight", "date"]),
  AssessmentView: obj({ id: uuid, termId: uuid, gradeId: uuid, learningAreaId: uuid, name: string, type: string, maxMarks: money, weight: money, date, status: string }, ["id", "termId", "gradeId", "learningAreaId", "name", "type", "weight", "date", "status"]),
  ResultInput: obj({ studentId: uuid, subStrandId: uuid, marks: money, performanceLevelId: uuid, overrideReason: string, comment: string, expectedRevision: { type: "integer", minimum: 0 } }, ["studentId", "expectedRevision"]),
  ResultView: obj({ id: uuid, assessmentId: uuid, studentId: uuid, subStrandId: string, marks: money, performanceLevelId: uuid, comment: string, revision: number }, ["id", "assessmentId", "studentId", "performanceLevelId", "revision"]),
  LockInput: obj({ locked: boolean, reason: string }, ["locked", "reason"]),
  RatingInput: obj({ studentId: uuid, termId: uuid, category: en("competency", "value"), code: string, performanceLevelId: uuid }, ["studentId", "termId", "category", "code", "performanceLevelId"]),
  ReportCardInput: obj({ studentId: uuid, termId: uuid, classTeacherComment: string, headTeacherComment: string, nextTermOpeningDate: date, publish: boolean }, ["studentId", "termId"]),
  ReportCardView: obj({ id: uuid, studentId: uuid, termId: uuid, status: string, classTeacherComment: string, headTeacherComment: string, fileId: string, publishedAt: instant }, ["id", "studentId", "termId", "status"]),
  AttendanceInput: obj({ streamId: uuid, date, entries: arr(obj({ studentId: uuid, status: en("present", "absent", "late", "excused") }, ["studentId", "status"])) }, ["streamId", "date", "entries"]),
  AttendanceView: obj({ id: uuid, studentId: uuid, streamId: uuid, date, status: string }, ["id", "studentId", "streamId", "date", "status"]),
  ReportView: obj({ title: string, columns: arr(obj({ key: string, label: string }, ["key", "label"])), rows: arr({ type: "object", additionalProperties: { type: ["string", "number", "null", "boolean"] } }), generatedAt: instant }, ["title", "columns", "rows", "generatedAt"]),
  DocumentView: obj({ id: uuid, downloadUrl: string, expiresAt: instant }, ["id", "downloadUrl", "expiresAt"]),
  ReportFilterInput: obj({ from: date, to: date, termId: uuid, gradeId: uuid, studentId: uuid, minimumBalance: money, activePlan: boolean, format: en("json", "xlsx", "pdf", "csv") }),
  ModuleDecisionInput: obj({ decision: en("approved", "rejected"), reason: string }, ["decision", "reason"]),
  RefundPaidInput: obj({ reference: string }, ["reference"]),
  CollectionRefundView: obj({ id: uuid, paymentId: uuid, exceptionId: uuid, amount: money, status: string, reason: string, requestedBy: uuid, decidedBy: uuid, paidReference: string }, ["id", "paymentId", "amount", "status"]),
  SponsorBatchView: obj({ id: uuid, paymentId: uuid, sponsorId: uuid, allocatedAmount: money, heldAmount: money, remainderReason: string, status: string }, ["id", "paymentId", "sponsorId", "allocatedAmount", "heldAmount", "status"]),
  CurriculumEditInput: obj({ name: string, code: string, order: {type:"integer"}, isCore: boolean, pathway: {type:["string","null"]}, levels: arr(ref("LevelInput")), userId: uuid, streamId: uuid, learningAreaId: uuid, termId: uuid }),
  LearnerRatingView: obj({ id: uuid, studentId: uuid, termId: uuid, category: string, code: string, performanceLevelId: uuid }, ["id", "studentId", "termId", "category", "code", "performanceLevelId"]),
  BatchCardsInput: obj({ termId: uuid, studentIds: arr(uuid) }, ["termId", "studentIds"]),
  KnecExportInput: obj({ termId: uuid, gradeId: uuid, format: en("csv", "xlsx") }, ["termId", "format"]),
  BotTermInput: obj({termId:uuid}, ["termId"]),
  BotMonthInput: obj({month:{type:"string",pattern:"^\\d{4}-(0[1-9]|1[0-2])$"}},["month"]),
  BotTermResultView: obj({learningAreaId:uuid,learningArea:string,percent:{type:["string","null"]},level:{type:["string","null"]}},["learningAreaId","learningArea","percent","level"]),
  BotBalanceView: obj({balance:money,lastPayment: {type:["object","null"],properties:{amount:money,createdAt:instant,status:string}}},["balance"]),
  BotDocumentListView: obj({invoices:arr(obj({id:uuid,createdAt:instant},["id","createdAt"])),receipts:arr(obj({id:uuid,createdAt:instant},["id","createdAt"])),reportCards:arr(obj({id:uuid,termId:uuid},["id","termId"]))},["invoices","receipts","reportCards"]),
  BotSchoolView: obj({name:string,phone:{type:["string","null"]},email:{type:["string","null"]},address:{type:["string","null"]},paybill:{type:["string","null"]},terms:arr(obj({name:string,startDate:date,endDate:date},["name","startDate","endDate"]))},["name","terms"]),
  FailedJobsView: obj({jobs:arr(obj({id:uuid,name:string,state:string,retryCount:number,completedAt:instant})),messages:arr(obj({id:uuid,template:string,status:string,error:string,attempts:number})),integrations:arr(obj({id:uuid,provider:string,event:string,status:string,createdAt:instant}))},["jobs","messages","integrations"]),
  ApprovalInboxItem: obj({id:uuid,type:string,studentId:{type:["string","null"],format:"uuid"},amount:money,requestedBy:uuid,createdAt:instant,canApprove:boolean},["id","type","amount","requestedBy","createdAt","canApprove"]),
  ModuleDashboardView: obj({date,termId:{type:["string","null"]},finance:{type:["object","null"],properties:{todayCollected:money,channels:{type:"object",additionalProperties:money},termBilled:money,termCollected:money,unmatchedCount:number,defaulterCount:number,reconciliation:{type:["object","null"],properties:{id:uuid,status:string,provider:string,createdAt:instant}}}},academics:obj({assessments:number,locked:number,results:number,publishedReportCards:number},["assessments","locked","results","publishedReportCards"]),attendance:arr(obj({status:string,count:number},["status","count"]))},["date","termId","finance","academics","attendance"]),
};
const paths = {};
schemas.LevelInput = schemas.CurriculumInput.properties.levels.items;
function operation(path, method, operationId, response, input, parameters = []) {
  const o = { operationId, parameters, responses: { 200: { description: "Success", content: { "application/json": { schema: response } } } } };
  if (input) o.requestBody = { required: true, content: { "application/json": { schema: ref(input) } } };
  (paths[path] ??= {})[method] = o;
}
const id = [{ name: "id", in: "path", required: true, schema: uuid }];
const query = names => names.map(name => ({ name, in: "query", schema: string }));
operation("integrations", "get", "listIntegrationStatus", arr(ref("IntegrationStatus")));
operation("integrations", "put", "configureIntegration", ref("IntegrationStatus"), "IntegrationInput");
operation("registration", "post", "registerDarajaCallbacks", ref("ActionResult"));
operation("payments", "get", "listIncomingPayments", arr(ref("IncomingPaymentView")), null, query(["status"]));
operation("payments", "post", "ingestIncomingPayment", ref("IncomingPaymentView"), "IncomingInput");
operation("queue", "get", "listPaymentExceptions", arr(ref("ExceptionView")));
operation("resolution", "post", "resolvePaymentException", ref("ActionResult"), "ResolutionInput", id);
operation("stk", "post", "startStkPayment", ref("StkView"), "StkInput");
operation("stkStatus", "get", "getStkPaymentStatus", ref("StkView"), null, id);
operation("statementPreview", "post", "previewBankStatement", ref("StatementPreview"), "StatementFileInput");
operation("statements", "post", "reconcileStatement", ref("ReconView"), "StatementInput");
operation("statements", "get", "listReconciliationRuns", arr(ref("ReconView")));
operation("sponsor", "post", "allocateSponsorPayment", ref("ActionResult"), "SponsorInput");
operation("plans", "get", "listPaymentPlans", arr(ref("PlanView")));
operation("plans", "post", "createPaymentPlan", ref("PlanView"), "PlanInput");
operation("planDecision", "post", "decidePaymentPlan", ref("PlanView"), "DecisionInput", id);
operation("messages", "get", "listMessageDeliveries", arr(ref("MessageView")));
operation("messages", "post", "sendSchoolMessage", ref("MessageView"), "MessageInput");
operation("curriculum", "get", "getCurriculum", ref("CurriculumView"));
operation("curriculum", "post", "saveCurriculum", ref("ActionResult"), "CurriculumInput");
operation("curriculumSeed", "post", "seedCurriculumScales", ref("ActionResult"));
operation("assessments", "get", "listAssessments", arr(ref("AssessmentView")), null, query(["termId", "gradeId"]));
operation("assessments", "post", "createAssessment", ref("AssessmentView"), "AssessmentInput");
operation("results", "get", "listAssessmentResults", arr(ref("ResultView")), null, id);
operation("results", "put", "saveAssessmentResult", ref("ResultView"), "ResultInput", id);
operation("assessmentLock", "post", "setAssessmentLock", ref("AssessmentView"), "LockInput", id);
operation("ratings", "post", "saveLearnerRating", ref("ActionResult"), "RatingInput");
operation("reportCards", "get", "listReportCards", arr(ref("ReportCardView")), null, query(["studentId", "termId"]));
operation("reportCards", "post", "saveReportCard", ref("ReportCardView"), "ReportCardInput");
operation("reportCardPdf", "post", "generateReportCardPdf", ref("DocumentView"), null, id);
operation("attendance", "get", "getAttendanceRegister", arr(ref("AttendanceView")), null, query(["streamId", "date", "studentId"]));
operation("attendance", "put", "saveAttendanceRegister", arr(ref("AttendanceView")), "AttendanceInput");
operation("report", "post", "getSchoolReport", ref("ReportView"), "ReportFilterInput", [{ name: "type", in: "path", required: true, schema: string, description: "collections|fee-items|balances|defaulters|aged-arrears|unmatched|reconciliation|adjustments|sponsors|plans|statement|performance|attendance" }]);
operation("reportExport", "post", "exportSchoolReport", ref("DocumentView"), "ReportFilterInput", [{ name: "type", in: "path", required: true, schema: string }]);
operation("botIdentify", "post", "identifyBotGuardian", ref("BotIdentityView"), "BotIdentityInput");
operation("botOtpRequest", "post", "requestBotOtp", ref("ActionResult"), "BotIdentityInput");
operation("botOtpVerify", "post", "verifyBotOtp", ref("ActionResult"), "BotOtpInput");
operation("collectionRefunds","get","listCollectionRefunds",arr(ref("CollectionRefundView")));
operation("collectionRefundDecision","post","decideCollectionRefund",ref("CollectionRefundView"),"ModuleDecisionInput",id);
operation("collectionRefundPaid","post","payCollectionRefund",ref("CollectionRefundView"),"RefundPaidInput",id);
operation("sponsorBatches","get","listSponsorBatches",arr(ref("SponsorBatchView")));
operation("sponsorAcknowledgement","post","generateSponsorAcknowledgement",ref("DocumentView"),null,id);
operation("curriculumEdit","patch","editCurriculum",ref("ActionResult"),"CurriculumEditInput",[...id,{name:"kind",in:"path",required:true,schema:en("learning-area","strand","scale","assignment")}]);
operation("ratings","get","listLearnerRatings",arr(ref("LearnerRatingView")),null,query(["studentId","termId"]));
operation("batchCards","post","generateBatchReportCards",arr(obj({studentId:uuid,...schemas.DocumentView.properties},["studentId",...schemas.DocumentView.required])),"BatchCardsInput");
operation("sendReportCard","post","sendReportCard",ref("ActionResult"),null,id);
operation("knecExport","post","exportKnecResults",ref("DocumentView"),"KnecExportInput");
operation("failedJobs","get","listFailedJobs",ref("FailedJobsView"));
operation("retryJob","post","retryFailedJob",ref("ActionResult"),null,id);
operation("moduleDashboard","get","getModuleDashboard",ref("ModuleDashboardView"));
operation("approvalInbox","get","listApprovalInbox",arr(ref("ApprovalInboxItem")));
operation("botBalance","get","getBotBalance",ref("BotBalanceView"),null,id);
operation("botStatement","get","getBotStatement",ref("DocumentView"),null,id);
operation("botResults","post","getBotTermResults",arr(ref("BotTermResultView")),"BotTermInput",id);
operation("botAttendance","post","getBotAttendance",arr(obj({date,status:string},["date","status"])),"BotMonthInput",id);
operation("botReportCard","get","getBotReportCard",ref("DocumentView"),null,id);
operation("botReceipt","get","getBotReceipt",ref("DocumentView"),null,id);
operation("botInvoice","get","getBotInvoice",ref("DocumentView"),null,id);
operation("botDocuments","get","listBotDocuments",ref("BotDocumentListView"),null,id);
operation("botSchool","get","getBotSchoolInfo",ref("BotSchoolView"));
operation("botStk","post","startBotStk",ref("StkView"),"StkInput");
operation("botStkStatus","get","getBotStkStatus",ref("StkView"),null,id);
operation("botPending","get","listBotPendingPayments",arr(ref("ExceptionView")));
operation("botResolve","post","resolveBotPayment",ref("ActionResult"),"ResolutionInput",id);
operation("botPlan","post","requestBotPaymentPlan",ref("PlanView"),"PlanInput");
schemas.ReportCardView.properties.nextTermOpeningDate = {type:["string","null"],format:"date"};
for (const [name,path] of Object.entries(paths)) if(name.startsWith("bot")) for(const operation of Object.values(path)) {
 operation.description = "Custom Bot API: HMAC-SHA256(timestamp.method.originalUrl.normalizedGuardianPhone.exactRawBody). X-Timestamp is milliseconds; ±5 minutes; replay rejected. Sensitive documents/results require OTP.";
 operation.parameters.push(...["X-Api-Key","X-Timestamp","X-Signature","X-Guardian-Phone"].map(name=>({name,in:"header",required:true,schema:string})));
}
writeFileSync(new URL("./remaining.yaml", import.meta.url), JSON.stringify({ paths, components: { schemas } }, null, 2) + "\n");