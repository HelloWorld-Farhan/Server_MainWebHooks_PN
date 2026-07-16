import { Module } from "@nestjs/common";
import { GraphQLController } from "./graphql.controller";

@Module({
  controllers: [GraphQLController],
})
export class GraphQLModule {}
