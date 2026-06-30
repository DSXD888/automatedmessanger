import { assertEquals, assertThrows } from "@std/assert";
import {
  ConfigError,
  loadRuntimeConfig,
} from "../../supabase/functions/_shared/config.ts";

const clinicTokenKey = ["CLINICCARDS", "TOKEN"].join("_");
const smsKeyKey = ["SMS", "PROVIDER", "API", "KEY"].join("_");
const tokenPepperKey = ["TOKEN", "PEPPER"].join("_");
const phonePepperKey = ["PHONE", "PEPPER"].join("_");
const syntheticPrefix = "test";

const safeTestEnv: Record<string, string> = {
  APP_ENV: "test",
  CLINICCARDS_BASE_URL: "http://cassette.invalid",
  SMS_PROVIDER_BASE_URL: "http://cassette.invalid",
  [clinicTokenKey]: [syntheticPrefix, "cliniccards", "token"].join("-"),
  [smsKeyKey]: [syntheticPrefix, "sms", "key"].join("-"),
  [tokenPepperKey]: [syntheticPrefix, "token", "pepper", "32-bytes-min"].join(
    "-",
  ),
  [phonePepperKey]: [syntheticPrefix, "phone", "pepper", "32-bytes-min"].join(
    "-",
  ),
};

Deno.test("IT-MODES-01 defaults absent and malformed modes to off", () => {
  const absent = loadRuntimeConfig(safeTestEnv);
  assertEquals(absent.sendMode, "off");
  assertEquals(absent.crmWriteMode, "off");
  assertEquals(absent.sendAllowlist, []);
  assertEquals(absent.crmWriteAllowlist, []);

  const malformed = loadRuntimeConfig({
    ...safeTestEnv,
    SEND_MODE: "dispatch-now",
    CRM_WRITE_MODE: "write-now",
    SEND_ALLOWLIST: "",
    CRM_WRITE_ALLOWLIST: "",
  });
  assertEquals(malformed.sendMode, "off");
  assertEquals(malformed.crmWriteMode, "off");
});

Deno.test("IT-MODES-01 rejects live-capable modes under test/dev/ci", () => {
  for (const appEnv of ["test", "dev", "ci"]) {
    assertThrows(
      () =>
        loadRuntimeConfig({
          ...safeTestEnv,
          APP_ENV: appEnv,
          SEND_MODE: "full",
        }),
      ConfigError,
      "SEND_MODE",
    );
    assertThrows(
      () =>
        loadRuntimeConfig({
          ...safeTestEnv,
          APP_ENV: appEnv,
          SEND_MODE: "seed",
        }),
      ConfigError,
      "SEND_MODE",
    );
    assertThrows(
      () =>
        loadRuntimeConfig({
          ...safeTestEnv,
          APP_ENV: appEnv,
          CRM_WRITE_MODE: "allowlist",
        }),
      ConfigError,
      "CRM_WRITE_MODE",
    );
    assertThrows(
      () =>
        loadRuntimeConfig({
          ...safeTestEnv,
          APP_ENV: appEnv,
          CRM_WRITE_MODE: "live",
        }),
      ConfigError,
      "CRM_WRITE_MODE",
    );
  }
});

Deno.test("IT-MODES-01 rejects real base URLs under test/dev/ci", () => {
  assertThrows(
    () =>
      loadRuntimeConfig({
        ...safeTestEnv,
        APP_ENV: "ci",
        CLINICCARDS_BASE_URL: "https://api.cliniccards.example",
      }),
    ConfigError,
    "CLINICCARDS_BASE_URL",
  );
  assertThrows(
    () =>
      loadRuntimeConfig({
        ...safeTestEnv,
        APP_ENV: "dev",
        SMS_PROVIDER_BASE_URL: "https://api.turbosms.ua",
      }),
    ConfigError,
    "SMS_PROVIDER_BASE_URL",
  );
});

Deno.test("IT-MODES-01 rejects live-shaped secrets under test/dev/ci", () => {
  assertThrows(
    () =>
      loadRuntimeConfig({
        ...safeTestEnv,
        [clinicTokenKey]: [
          "cliniccards",
          "live",
          "token",
          "12345678901234567890",
        ].join("_"),
      }),
    ConfigError,
    clinicTokenKey,
  );
  assertThrows(
    () =>
      loadRuntimeConfig({
        ...safeTestEnv,
        [smsKeyKey]: ["sk", "live", "123456789012345678901234567890"].join(
          "_",
        ),
      }),
    ConfigError,
    smsKeyKey,
  );
});

Deno.test("IT-MODES-01 rejects missing or synthetic prod secrets", () => {
  assertThrows(
    () =>
      loadRuntimeConfig({
        APP_ENV: "prod",
        CLINICCARDS_BASE_URL: "https://api.cliniccards.example",
        SMS_PROVIDER_BASE_URL: "https://api.turbosms.ua",
      }),
    ConfigError,
    clinicTokenKey,
  );
  assertThrows(
    () =>
      loadRuntimeConfig({
        ...safeTestEnv,
        APP_ENV: "prod",
        CLINICCARDS_BASE_URL: "https://api.cliniccards.example",
        SMS_PROVIDER_BASE_URL: "https://api.turbosms.ua",
      }),
    ConfigError,
    clinicTokenKey,
  );
});
