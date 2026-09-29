import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import { AppModule } from './app.module.js';
import { auth } from './modules/auth/auth.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: process.env.WEB_ORIGIN || 'http://localhost:5173', credentials: true });
  // Better Auth receives the body stream before Express JSON middleware.
  app.getHttpAdapter().getInstance().all('/api/v1/auth/{*path}', toNodeHandler(auth));
  app.use(express.json({ limit: '20mb' }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1');
}

void bootstrap();
