import { Controller, Get } from "@nestjs/common";

import {
  getDefaultObdServiceNo,
  getObdServiceNumbers,
} from "@/server/telephony/obd-config";

@Controller("api/obd")
export class ObdController {
  @Get("service-numbers")
  getServiceNumbers() {
    const numbers = getObdServiceNumbers();

    return {
      numbers,
      defaultNumber: getDefaultObdServiceNo() || numbers[0] || null,
    };
  }
}
