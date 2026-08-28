import { NextResponse } from "next/server";
import { services } from "@/services/container";
import { toErrorResponse } from "@/infrastructure/http/error-response";

interface Context { params: Promise<{ id: string }> }
export async function GET(_request: Request, { params }: Context) { try { const { id } = await params; return NextResponse.json({ timeline: await services.timeline.getCurrent(id) }); } catch (error) { return toErrorResponse(error); } }
export async function POST(_request: Request, { params }: Context) { try { const { id } = await params; return NextResponse.json({ timeline: await services.timeline.build(id) }); } catch (error) { return toErrorResponse(error); } }
