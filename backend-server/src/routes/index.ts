import { Router } from 'express';
import authRoutes from './auth.routes.ts';
import caseRoutes from './case.routes.ts';
import fileRoutes from './file.routes.ts';
import forensicsRoutes from './forensics.routes.ts';
import auditRoutes from './audit.routes.ts';
import reportRoutes from './report.routes.ts';

const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'LegalLens Backend API',
    timestamp: new Date().toISOString()
  });
});

// Mount modules
apiRouter.use('/auth', authRoutes);
apiRouter.use('/cases', caseRoutes);
apiRouter.use('/', fileRoutes);
apiRouter.use('/', forensicsRoutes);
apiRouter.use('/', auditRoutes);
apiRouter.use('/', reportRoutes);

export default apiRouter;
