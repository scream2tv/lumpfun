import { NextResponse } from 'next/server';
import { listLaunches, type LaunchRecord } from '@/lib/midnight/launches';

export interface MidnightLaunchesResponse {
  network: 'preprod';
  launches: LaunchRecord[];
}

export async function GET() {
  const payload: MidnightLaunchesResponse = {
    network: 'preprod',
    launches: listLaunches('preprod'),
  };
  return NextResponse.json(payload);
}
