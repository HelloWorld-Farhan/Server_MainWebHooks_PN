import { Controller, Get } from "@nestjs/common";

import {
  getObdConfig,
  getObdServiceNumbers,
} from "@/server/telephony/obd-config";

@Controller("api/obd")
export class ObdController {
  @Get("service-numbers")
  getServiceNumbers() {
    const numbers = getObdServiceNumbers();
    const config = getObdConfig();

    return {
      numbers,
      defaultNumber: config.serviceNo || numbers[0] || null,
    };
  }
}
