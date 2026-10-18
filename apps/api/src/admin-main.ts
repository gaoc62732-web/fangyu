import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import express from 'express';
import { AdminPointsModule } from './modules/admin-points/admin-points.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';

@Module({ imports: [AdminPointsModule, CatalogModule] })
class LocalJsonModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(LocalJsonModule, { bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: [/^http:\/\/(localhost|127\.0\.0\.1)(:5173|:5174)?$/],
    credentials: false,
  });
  app.use(express.json({ limit: '20mb' }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.ADMIN_PORT || 3001), '127.0.0.1');
}

void bootstrap();
