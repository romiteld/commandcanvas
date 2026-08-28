import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(root, relativePath), "utf8");

describe("embedded YOLO26 open-source release contract", () => {
  it("licenses this release under GNU AGPL version 3 only", () => {
    const packageJson = JSON.parse(read("package.json")) as {
      license?: string;
    };
    const packageLock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { license?: string }>;
    };
    const license = read("LICENSE");

    expect(packageJson.license).toBe("AGPL-3.0-only");
    expect(packageLock.packages[""]?.license).toBe("AGPL-3.0-only");
    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3, 19 November 2007");
    expect(license).toContain("13. Remote Network Interaction");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
  });

  it("publishes one precise corresponding-source and model-provenance path", () => {
    const readme = read("README.md");
    const source = read("SOURCE.md");
    const notices = read("THIRD_PARTY_NOTICES.md");
    const modelNotice = read("public/models/README.md");

    expect(readme).toContain("[GNU Affero General Public License v3.0 only](LICENSE)");
    expect(readme).toContain("[Corresponding Source](SOURCE.md)");
    expect(source).toContain("https://github.com/romiteld/commandcanvas");
    expect(source).toContain("2abb91a7030e1aa5231ec900ccb2c07ab3f03460");
    expect(source).toContain("ultralytics==8.4.33");
    expect(source).toContain("imgsz=320");
    expect(source).toContain("opset=17");
    expect(notices).toContain("License: AGPL-3.0-only");
    expect(notices).toContain("https://www.ultralytics.com/license");
    expect(notices).toContain("https://github.com/ultralytics/ultralytics");
    expect(notices).not.toContain("agpl-3.0-review-required");
    expect(modelNotice).toContain(
      "yolo26_hand_pose_320_fp16.onnx",
    );
    expect(modelNotice).toContain(
      "07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc",
    );
    expect(modelNotice).toContain("AGPL-3.0-only");
  });
});
