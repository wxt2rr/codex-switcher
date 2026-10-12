import { startCswPluginServer } from "../../../packages/plugin-sdk/dist/index.js";

startCswPluginServer({
  provider: {
    describe() {
      return {
        id: "csw-demo-provider",
        displayName: "CSW Demo Provider",
        authMethods: ["api_key"],
        endpoints: [{ protocol: "responses", baseUrl: "https://demo.example/v1", modelsPath: "/models" }],
      };
    },
    models() {
      return [{ id: "demo-model", protocols: ["responses"], source: "preset", capabilities: { tools: true, streaming: true } }];
    },
  },
});
