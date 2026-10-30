// Cloudflare Pages Function for GET /api/termine; the logic lives in server/anfrage.mjs.
import { handleRequest } from "../../server/anfrage.mjs";

export const onRequest = (context) => handleRequest(context.request, context.env);
