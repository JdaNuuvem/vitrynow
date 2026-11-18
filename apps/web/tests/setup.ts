import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// `next/font/local` só funciona dentro do compilador do Next; nos testes a fonte vira uma classe vazia.
vi.mock("next/font/local", () => ({ default: () => ({ className: "", variable: "", style: { fontFamily: "" } }) }));

afterEach(() => cleanup());
