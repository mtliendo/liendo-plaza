import { errorResponse } from "@/lib/http";
import { handleApi } from "@/lib/api";

async function run(req: Request) {
  try {
    return await handleApi(req);
  } catch (error) {
    return errorResponse(error);
  }
}

export const GET = run;
export const POST = run;
export const PATCH = run;
export const PUT = run;
export const DELETE = run;
