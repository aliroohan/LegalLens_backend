import app from './app.ts';
import { ENV } from './config/env.ts';
import { connectDatabase } from './config/database.ts';
import { logger } from './utils/logger.ts';

const startServer = async () => {
  try {
    // Initialize Database
    await connectDatabase();

    const PORT = ENV.PORT;
    app.listen(PORT, () => {
      logger.info(`LegalLens backend server is running on http://localhost:${PORT}`);
      logger.info(`Environment: ${ENV.NODE_ENV}`);
      logger.info(`Python Forensics Service target: ${ENV.PYTHON_FORENSICS_URL}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();