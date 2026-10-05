import { Router } from 'express';
import authRoutes from './auth.routes.ts';
import caseRoutes from './case.routes.ts';
import fileRoutes from './file.routes.ts';
import forensicsRoutes from './forensics.routes.ts';
import organizationRoutes from './organization.routes.ts';
import notificationRoutes from './notification.routes.ts';
import auditRoutes from './audit.routes.ts';
import reportRoutes from './report.routes.ts';

const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'LegalLens Backend API',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

// Mount modules
apiRouter.use('/auth', authRoutes);
apiRouter.use('/cases', caseRoutes);
apiRouter.use('/', fileRoutes);
apiRouter.use('/', forensicsRoutes);
apiRouter.use('/', organizationRoutes);
apiRouter.use('/', notificationRoutes);
apiRouter.use('/', auditRoutes);
apiRouter.use('/', reportRoutes);

export default apiRouter;
