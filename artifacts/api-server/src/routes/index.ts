import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import staffRouter from "./staff";
import academicsRouter from "./academics";
import studentsRouter from "./students";
import guardiansRouter from "./guardians";
import importsRouter from "./imports";
import dashboardRouter from "./dashboard";
import { authenticate } from "../lib/core";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(authenticate);
router.use(staffRouter);
router.use(academicsRouter);
router.use(studentsRouter);
router.use(guardiansRouter);
router.use(importsRouter);
router.use(dashboardRouter);

export default router;
