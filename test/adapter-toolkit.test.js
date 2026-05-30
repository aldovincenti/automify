import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import {
  computerCall,
  functionCall,
  fileToEvaluate,
  fileToData,
  filesToEvaluate,
  filesToData,
  getComputerTool,
  getFunctionOutputs,
  getInputText,
  getLastComputerScreenshot,
  getOutputText,
  message,
  parseOutputJson,
  parseDataUrl,
  response,
  runCommandCall,
  testModelAdapter,
  toDataUrl
} from "../src/index.js";

test("adapter toolkit builds common response items", () => {
  assert.deepEqual(response({ id: "resp_1", output: [message("hello")] }), {
    id: "resp_1",
    output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }]
  });
  assert.equal(computerCall({ type: "wait" }, { callId: "call_1" }).call_id, "call_1");
  assert.deepEqual(runCommandCall("npm test", { callId: "call_2", cwd: "/tmp" }), {
    type: "function_call",
    name: "run_command",
    call_id: "call_2",
    arguments: JSON.stringify({ command: "npm test", cwd: "/tmp" })
  });
  assert.equal(functionCall("custom", { ok: true }, { callId: "call_3" }).arguments, JSON.stringify({ ok: true }));
});

test("adapter toolkit reads payload content", () => {
  const image = toDataUrl(Buffer.from("png"));
  const payload = {
    tools: [{ type: "computer" }],
    input: [
      { role: "user", content: [{ type: "input_text", text: "Hello" }] },
      { type: "computer_call_output", call_id: "call_1", output: { image_url: image } },
      { type: "function_call_output", call_id: "call_2", output: JSON.stringify({ ok: true }) }
    ]
  };

  assert.equal(getInputText(payload), "Hello");
  assert.equal(getComputerTool(payload).type, "computer");
  assert.equal(getLastComputerScreenshot(payload).buffer.toString(), "png");
  assert.deepEqual(getFunctionOutputs(payload), [{ callId: "call_2", output: { ok: true } }]);
});

test("adapter toolkit reads text and json from model responses", () => {
  const modelResponse = response({
    id: "resp_1",
    output: [
      message('{"email":"support@example.com","found":true}'),
      { type: "message", content: [{ type: "output_text", text: "extra" }] }
    ]
  });

  assert.equal(getOutputText(modelResponse), '{"email":"support@example.com","found":true}\n\nextra');
  assert.deepEqual(
    parseOutputJson(response({ output: [message('{"email":"support@example.com","found":true}')] })),
    { email: "support@example.com", found: true }
  );
});

test("adapter toolkit parses data URLs", () => {
  const parsed = parseDataUrl("data:text/plain;base64,aGVsbG8=");

  assert.equal(parsed.mediaType, "text/plain");
  assert.equal(parsed.buffer.toString(), "hello");
});

test("file data helpers convert files for do data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-file-data-"));
  const textPath = join(dir, "note.txt");
  await writeFile(textPath, "hello data");

  const text = await fileToData(textPath);
  const dataUrl = await fileToData(textPath, { format: "data_url" });
  const list = await filesToData([{ path: textPath, name: "renamed.txt", format: "metadata" }]);

  assert.equal(text.name, "note.txt");
  assert.equal(text.mediaType, "text/plain");
  assert.equal(text.text, "hello data");
  assert.match(dataUrl.dataUrl, /^data:text\/plain;base64,/);
  assert.equal(list[0].name, "renamed.txt");
  assert.equal(list[0].text, undefined);
});

test("file evaluation helpers convert images and text to model content", async () => {
  const dir = await mkdtemp(join(tmpdir(), "automify-file-evaluate-"));
  const textPath = join(dir, "note.txt");
  const imagePath = join(dir, "image.png");
  await writeFile(textPath, "hello evaluation");
  await writeFile(imagePath, Buffer.from("fake-png"));

  const text = await fileToEvaluate(textPath);
  const image = await fileToEvaluate(imagePath, { detail: "low" });
  const list = await filesToEvaluate([textPath, imagePath]);

  assert.equal(text.type, "input_text");
  assert.match(text.text, /hello evaluation/);
  assert.equal(image.type, "input_image");
  assert.equal(image.detail, "low");
  assert.match(image.image_url, /^data:image\/png;base64,/);
  assert.equal(list.length, 2);
});

test("testModelAdapter validates adapter shape", async () => {
  await testModelAdapter({
    async respond() {
      return response({ output: [message("ok")] });
    }
  });
});
