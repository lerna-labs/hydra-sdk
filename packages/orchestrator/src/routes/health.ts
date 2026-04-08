import { Router } from 'express';
import type { HealthChecker } from '../services/health-checker.js';

export function createHealthRouter(healthChecker: HealthChecker): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const decision = healthChecker.evaluate();
    const status = decision.canProvision ? 200 : 503;
    res.status(status).json(decision);
  });

  return router;
}
