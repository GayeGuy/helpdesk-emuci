// Sélection du backend de stockage : PostgreSQL (Neon) si DATABASE_URL, sinon JSON local.
import crypto from 'node:crypto';
import { createJsonStore } from './store-json.js';
import { createPgStore } from './store-pg.js';

export const id = () => crypto.randomUUID();

export async function createStore() {
  const url = process.env.DATABASE_URL;
  const store = url ? createPgStore(url) : createJsonStore();
  store.backend = url ? 'postgres' : 'json';
  await store.init();
  return store;
}
