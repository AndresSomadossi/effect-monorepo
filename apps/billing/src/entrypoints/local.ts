import { createServer } from "node:http";
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Config, Layer } from "effect";
import { HttpRouter } from "effect/http";

import { AnnouncementRelayLoop, makeContexts, Routes } from "#composition/index";
import { world } from "#composition/world";
import { OrganizationAccess } from "#inbound/access/index";

const HttpServerLive = NodeHttpServer.layerConfig(createServer, { port: Config.Port("PORT").pipe(Config.withDefault(3000)) });

const Main = Layer.mergeAll(HttpRouter.serve(Routes), AnnouncementRelayLoop).pipe(Layer.provide(Layer.mergeAll(makeContexts(world), OrganizationAccess.layerConfig)), Layer.provide(HttpServerLive));

Layer.launch(Main).pipe(NodeRuntime.runMain);
