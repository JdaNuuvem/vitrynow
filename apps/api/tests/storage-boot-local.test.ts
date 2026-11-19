import { describe, expect, it } from "vitest";
import { assertStorageBootConfig } from "../src/lib/objectStorage";

const S3 = { STORAGE_S3_ENDPOINT: "https://s3.example", STORAGE_S3_BUCKET: "b", STORAGE_S3_ACCESS_KEY_ID: "k", STORAGE_S3_SECRET_ACCESS_KEY: "s", STORAGE_PUBLIC_BASE_URL: "https://cdn.example/media" };

describe("boot do storage (ADR-0017)", () => {
  it("dev e teste não exigem nada", () => {
    expect(() => assertStorageBootConfig({ NODE_ENV: "test" })).not.toThrow();
    expect(() => assertStorageBootConfig({ NODE_ENV: "development" })).not.toThrow();
  });
  it("produção sem driver continua exigindo as 5 variáveis do S3", () => {
    expect(() => assertStorageBootConfig({ NODE_ENV: "production" })).toThrow(/faltam/);
    expect(() => assertStorageBootConfig({ NODE_ENV: "production", ...S3 })).not.toThrow();
    expect(() => assertStorageBootConfig({ ...S3 })).not.toThrow(); // NODE_ENV ausente conta como produção
  });
  it("driver local NÃO exige S3, mas exige pasta absoluta e URL https", () => {
    const base = { NODE_ENV: "production", STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: "/var/lib/cardapio/uploads", STORAGE_PUBLIC_BASE_URL: "https://dominio.example/media" };
    expect(() => assertStorageBootConfig(base)).not.toThrow();
    expect(() => assertStorageBootConfig({ ...base, STORAGE_LOCAL_DIR: "C:\\dados\\uploads" })).not.toThrow();
    expect(() => assertStorageBootConfig({ ...base, STORAGE_LOCAL_DIR: undefined })).toThrow(/STORAGE_LOCAL_DIR/);
    expect(() => assertStorageBootConfig({ ...base, STORAGE_LOCAL_DIR: "uploads" })).toThrow(/absoluto/);
    expect(() => assertStorageBootConfig({ ...base, STORAGE_LOCAL_DIR: "../uploads" })).toThrow(/absoluto/);
    expect(() => assertStorageBootConfig({ ...base, STORAGE_PUBLIC_BASE_URL: undefined })).toThrow(/STORAGE_PUBLIC_BASE_URL/);
    expect(() => assertStorageBootConfig({ ...base, STORAGE_PUBLIC_BASE_URL: "http://dominio.example/media" })).toThrow(/https/);
  });
  it("driver desconhecido derruba o boot (nada de cair em silêncio)", () => {
    expect(() => assertStorageBootConfig({ NODE_ENV: "production", STORAGE_DRIVER: "ftp", ...S3 })).toThrow(/STORAGE_DRIVER inválido/);
  });
});