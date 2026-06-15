import 'reflect-metadata';
import { bootstrapHttpApp } from './core/bootstrap/bootstrap-http-app';
import { createServerLogger } from './core/logging/server-logger';

const logger = createServerLogger('Bootstrap');

bootstrapHttpApp().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error), {
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exitCode = 1;
});
