import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get()
  getHealth() {
    return {
      service: "propnex-main-server",
      status: "ok",
      graphql: "/graphql",
      docs: "/api/docs",
    };
  }

  @Get("health")
  health() {
    return { status: "ok" };
  }
}
