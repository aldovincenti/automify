import assert from "node:assert/strict";
import { test } from "node:test";

import { AutomifyError, initAutomify } from "../src/index.js";

test("initAutomify shares one custom provider client across factory methods", async () => {
  const client = {
    async createResponse() {
      return { id: "resp_done", output: [] };
    }
  };
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "custom-test-model",
      client
    },
    maxSteps: 3
  });
  const browser = await automify.browser({
    computer: makeBrowserComputer()
  });
  const cli = automify.cli({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });
  const dockerComputer = await automify.dockerComputer({
    startupCommand: "xterm",
    start: false,
    containerName: "automify-init-docker-computer"
  });
  const virtualComputer = await automify.virtualComputer({
    image: "/tmp/automify-init-virtual.qcow2",
    startupCommand: "xterm",
    start: false,
    vmName: "automify-init-virtual-computer"
  });
  const virtualCli = automify.virtualCli({
    image: "/tmp/automify-init-virtual-cli.qcow2"
  });
  const localComputer = await automify.localComputer({
    computer: makeCloseableComputer()
  });
  const computer = automify.computer({
    computer: makeComputer()
  });

  assert.equal(browser.client, client);
  assert.equal(cli.client, client);
  assert.equal(dockerComputer.client, client);
  assert.equal(virtualComputer.client, client);
  assert.equal(virtualCli.client, client);
  assert.equal(localComputer.client, client);
  assert.equal(computer.client, client);
  assert.equal(browser.maxSteps, 3);
  assert.equal(cli.maxSteps, 3);
  assert.equal(dockerComputer.maxSteps, 3);
  assert.equal(virtualComputer.maxSteps, 3);
  assert.equal(virtualCli.maxSteps, 3);
  assert.equal(localComputer.maxSteps, 3);
  assert.equal(dockerComputer.session.name, "automify-init-docker-computer");
  assert.equal(virtualComputer.session.name, "automify-init-virtual-computer");

  await dockerComputer.close();
  await virtualComputer.close();
  await virtualCli.close();
  await localComputer.close();
});

test("initAutomify defaults every adapter to 100 maxSteps", async () => {
  const client = {
    async createResponse() {
      return { id: "resp_done", output: [] };
    }
  };
  const automify = initAutomify({
    provider: {
      type: "custom",
      model: "custom-test-model",
      client
    }
  });
  const browser = await automify.browser({
    computer: makeBrowserComputer()
  });
  const cli = automify.cli({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });
  const dockerCli = automify.dockerCli({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });
  const dockerComputer = await automify.dockerComputer({
    startupCommand: "xterm",
    start: false,
    containerName: "automify-init-default-docker-computer"
  });
  const virtualComputer = await automify.virtualComputer({
    image: "/tmp/automify-init-default-virtual.qcow2",
    startupCommand: "xterm",
    start: false,
    vmName: "automify-init-default-virtual-computer"
  });
  const virtualCli = automify.virtualCli({
    image: "/tmp/automify-init-default-virtual-cli.qcow2"
  });
  const localComputer = await automify.localComputer({
    computer: makeCloseableComputer()
  });
  const computer = automify.computer({
    computer: makeComputer()
  });

  assert.equal(browser.maxSteps, 100);
  assert.equal(cli.maxSteps, 100);
  assert.equal(dockerCli.maxSteps, 100);
  assert.equal(dockerComputer.maxSteps, 100);
  assert.equal(virtualComputer.maxSteps, 100);
  assert.equal(virtualCli.maxSteps, 100);
  assert.equal(localComputer.maxSteps, 100);
  assert.equal(computer.maxSteps, 100);

  await browser.close();
  await dockerCli.close();
  await dockerComputer.close();
  await virtualComputer.close();
  await virtualCli.close();
  await localComputer.close();
});

test("initAutomify rejects legacy top-level OpenAI provider config", () => {
  assert.throws(() => initAutomify(), /provider/);

  assert.throws(() => initAutomify({ openaiApiKey: "token", model: "gpt-5.5" }), AutomifyError);

  assert.throws(() => initAutomify({ provider: "openai", openaiApiKey: "token", model: "gpt-5.5" }), AutomifyError);

  assert.throws(() => initAutomify({ client: { async createResponse() {} }, model: "custom" }), AutomifyError);
});

test("initAutomify accepts OpenAI provider object", async () => {
  const requests = [];
  const automify = initAutomify({
    provider: {
      type: "openai",
      apiKey: "token",
      model: "gpt-5.5",
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: "resp_done", output: [] }), { status: 200 });
      }
    }
  });
  const cli = automify.cli({
    runner: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  await cli.do("Say done");

  assert.equal(requests[0].model, "gpt-5.5");
});

test("initAutomify defaults OpenAI computer surfaces to the provider model", async () => {
  const requests = [];
  const automify = initAutomify({
    provider: {
      type: "openai",
      apiKey: "token",
      model: "gpt-5.5",
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: "resp_done", output: [] }), { status: 200 });
      }
    }
  });

  const computer = automify.computer({
    computer: makeComputer()
  });

  await computer.do("Look at the screen");

  assert.equal(requests[0].model, "gpt-5.5");
  assert.deepEqual(requests[0].tools, [{ type: "computer" }]);
});

test("initAutomify lets OpenAI computer model defaults be overridden", async () => {
  const requests = [];
  const automify = initAutomify({
    provider: {
      type: "openai",
      apiKey: "token",
      model: "gpt-5.5",
      computerModel: "custom-computer-model",
      fetchImpl: async (_url, init) => {
        requests.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ id: "resp_done", output: [] }), { status: 200 });
      }
    }
  });

  const computer = automify.computer({
    computer: makeComputer(),
    model: "per-run-computer-model"
  });

  await computer.do("Look at the screen");

  assert.equal(requests[0].model, "per-run-computer-model");
});

test("initAutomify uses Anthropic-friendly screenshot defaults", async () => {
  const automify = initAutomify({
    provider: {
      type: "anthropic",
      apiKey: "token",
      model: "claude-test",
      fetchImpl: async () => new Response(JSON.stringify({ id: "msg_done", content: [] }), { status: 200 })
    }
  });
  const computer = automify.computer({
    computer: makeComputer()
  });

  assert.equal(computer.screenshotMaxWidth, 1280);
  assert.equal(computer.screenshotMaxHeight, 800);
});

test("initAutomify validates provider object", () => {
  assert.throws(() => initAutomify({ provider: { type: "openai", apiKey: "token" } }), /provider\.model/);

  assert.throws(() => initAutomify({ provider: { type: "openai", model: "gpt-5.5" } }), /provider\.apiKey/);

  assert.throws(
    () => initAutomify({ provider: { type: "custom", model: "custom-model" } }),
    /provider\.adapter or provider\.client/
  );
});

function makeComputer() {
  return {
    execute() {},
    screenshot() {
      return Buffer.from("screen");
    }
  };
}

function makeBrowserComputer() {
  return {
    ...makeComputer(),
    browser: {},
    context: {},
    page: {},
    async goto() {},
    async close() {}
  };
}

function makeCloseableComputer() {
  return {
    ...makeComputer(),
    async close() {}
  };
}
