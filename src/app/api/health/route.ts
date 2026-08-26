import { NextResponse } from "next/server";
import { services } from "@/services/container";
import { logger } from "@/infrastructure/logging/logger";

export async function GET(): Promise<NextResponse> {
  const report = await services.health.check();
  const httpStatus = report.status === "DOWN" ? 503 : 200;

  logger.info({ event: "health.checked", message: report.status });

  return NextResponse.json(report, { status: httpStatus });
}
