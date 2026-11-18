import { describe, expect, it } from "vitest";
import {
  closeTodayUntil,
  computeStoreStatus,
  localParts,
  localToUtc,
  parseStoredSchedule,
  pruneExceptions,
  validateSchedule,
  type Interval,
  type Schedule,
  type StatusInput,
} from "../../src/modules/storeHours/storeHours.domain";

// Núcleo puro do B5: CA-B5-01..07 e 10, fuso e horário de verão. Relógio sempre injetado.
// 2026-11-16 é segunda-feira; America/Sao_Paulo = UTC-3 (sem horário de verão).

const SP = "America/Sao_Paulo";
const everyDay = (intervals: Interval[]): Interval[][] => Array.from({ length: 7 }, () => intervals);
const schedule = (week: Interval[][], extra: Partial<Schedule> = {}): Schedule => ({ week, exceptions: [], cutoffMinutes: 0, ...extra });
const at = (iso: string) => new Date(iso);

function status(overrides: Partial<StatusInput> & { schedule: Schedule | null }, now: string) {
  return computeStoreStatus({ timezone: SP, acceptingOrders: true, pausedUntil: null, closedUntil: null, now: at(now), ...overrides });
}

describe("fuso horário", () => {
  it("localParts e localToUtc são inversos em São Paulo (UTC-3)", () => {
    const l = localParts(at("2026-11-16T21:00:00Z"), SP);
    expect(l).toMatchObject({ y: 2026, m: 11, d: 16, minutes: 18 * 60, weekday: 1 });
    expect(localToUtc(2026, 11, 16, 18 * 60, SP).toISOString()).toBe("2026-11-16T21:00:00.000Z");
    expect(localToUtc(2026, 11, 16, 26 * 60, SP).toISOString()).toBe("2026-11-17T05:00:00.000Z"); // 26:00 = 02:00 do dia seguinte
  });

  it("respeita o horário de verão (Nova York muda em 2026-03-08)", () => {
    const NY = "America/New_York";
    expect(localToUtc(2026, 3, 7, 12 * 60, NY).toISOString()).toBe("2026-03-07T17:00:00.000Z"); // EST -5
    expect(localToUtc(2026, 3, 8, 12 * 60, NY).toISOString()).toBe("2026-03-08T16:00:00.000Z"); // EDT -4
    expect(localToUtc(2026, 3, 8, 3 * 60 + 30, NY).toISOString()).toBe("2026-03-08T07:30:00.000Z");
  });
});

describe("CA-B5-01 · grade seg-dom 18:00-23:00", () => {
  const s = schedule(everyDay([{ start: "18:00", end: "23:00" }]));

  it("17:59 (fuso da loja) é recusado com próxima abertura 18:00; às 18:00 é aceito", () => {
    const before = status({ schedule: s }, "2026-11-16T20:59:00Z");
    expect(before).toMatchObject({ status: "FECHADO", reason: "OUTSIDE_HOURS", nextOpenAt: "2026-11-16T21:00:00.000Z", message: "Abrimos hoje às 18:00" });
    const open = status({ schedule: s }, "2026-11-16T21:00:00Z");
    expect(open).toMatchObject({ status: "ABERTO", reason: null, closesAt: "2026-11-17T02:00:00.000Z", message: "Aberto até 23:00" });
  });

  it("depois do fechamento a próxima abertura é amanhã", () => {
    const closed = status({ schedule: s }, "2026-11-17T02:00:00Z"); // 23:00 em ponto: fim exclusivo
    expect(closed).toMatchObject({ status: "FECHADO", reason: "OUTSIDE_HOURS", nextOpenAt: "2026-11-17T21:00:00.000Z", message: "Abrimos amanhã às 18:00" });
  });
});

describe("CA-B5-02 · intervalo que passa da meia-noite", () => {
  const friday = [[], [], [], [], [], [{ start: "18:00", end: "02:00" }], []] as Interval[][];
  const s = schedule(friday);

  it("sábado 01:30 está aberto e sábado 02:00 está fechado", () => {
    expect(status({ schedule: s }, "2026-11-21T04:30:00Z").status).toBe("ABERTO"); // sáb 01:30
    expect(status({ schedule: s }, "2026-11-21T04:59:59Z").status).toBe("ABERTO");
    const closed = status({ schedule: s }, "2026-11-21T05:00:00Z"); // sáb 02:00
    expect(closed).toMatchObject({ status: "FECHADO", reason: "OUTSIDE_HOURS" });
    expect(closed.nextOpenAt).toBe("2026-11-27T21:00:00.000Z"); // próxima sexta 18:00
  });

  it("sexta 17:59 fechado, sexta 18:00 aberto", () => {
    expect(status({ schedule: s }, "2026-11-20T20:59:00Z").status).toBe("FECHADO");
    expect(status({ schedule: s }, "2026-11-20T21:00:00Z").status).toBe("ABERTO");
  });
});

describe("CA-B5-03 · antecedência de corte", () => {
  const s = schedule(everyDay([{ start: "18:00", end: "23:00" }]), { cutoffMinutes: 30 });
  it("com corte de 30 min e fechamento às 23:00: 22:31 recusa e 22:29 aceita", () => {
    expect(status({ schedule: s }, "2026-11-17T01:31:00Z").status).toBe("FECHADO"); // 22:31
    const ok = status({ schedule: s }, "2026-11-17T01:29:00Z"); // 22:29
    expect(ok).toMatchObject({ status: "ABERTO", message: "Aberto até 22:30" });
    expect(status({ schedule: s }, "2026-11-17T01:30:00Z").status).toBe("FECHADO"); // 22:30 em ponto
  });

  it("grade de 24 h não perde o corte entre um dia e outro (janelas contíguas são unidas)", () => {
    const full = schedule(everyDay([{ start: "00:00", end: "24:00" }]), { cutoffMinutes: 30 });
    for (const now of ["2026-11-17T02:45:00Z", "2026-11-17T03:00:00Z", "2026-11-17T03:10:00Z"]) {
      expect(status({ schedule: full }, now), now).toMatchObject({ status: "ABERTO", closesAt: null, message: "Aberto" });
    }
  });
});

describe("CA-B5-04/05 · pausar e fechar por hoje", () => {
  const s = schedule(everyDay([{ start: "18:00", end: "23:00" }]));
  const now = "2026-11-16T22:00:00Z"; // 19:00, dentro do horário

  it("pausa de 30 min: PAUSADO com motivo PAUSED; passada a pausa, volta sozinho", () => {
    const pausedUntil = at("2026-11-16T22:30:00Z");
    expect(status({ schedule: s, pausedUntil }, now)).toMatchObject({ status: "PAUSADO", reason: "PAUSED", nextOpenAt: pausedUntil.toISOString(), message: "Voltamos em 30 min" });
    expect(status({ schedule: s, pausedUntil }, "2026-11-16T22:29:30Z").message).toBe("Voltamos em 1 min");
    expect(status({ schedule: s, pausedUntil }, "2026-11-16T22:30:00Z").status).toBe("ABERTO");
  });

  it("fechar por hoje às 15:00: fechado até a próxima abertura da grade e depois abre sozinho", () => {
    const closedUntil = closeTodayUntil(s, SP, at("2026-11-16T18:00:00Z")); // 15:00
    expect(closedUntil.toISOString()).toBe("2026-11-16T21:00:00.000Z"); // 18:00 de hoje
    expect(status({ schedule: s, closedUntil }, "2026-11-16T18:00:00Z")).toMatchObject({ status: "FECHADO", reason: "CLOSED_TODAY" });
    expect(status({ schedule: s, closedUntil }, "2026-11-16T20:59:59Z").reason).toBe("CLOSED_TODAY");
    expect(status({ schedule: s, closedUntil }, "2026-11-16T21:00:00Z").status).toBe("ABERTO");
  });

  it("fechar por hoje dentro do horário vai até a abertura de amanhã; sem grade, até a meia-noite local", () => {
    expect(closeTodayUntil(s, SP, at(now)).toISOString()).toBe("2026-11-17T21:00:00.000Z");
    expect(closeTodayUntil(null, SP, at("2026-11-16T18:00:00Z")).toISOString()).toBe("2026-11-17T03:00:00.000Z"); // 00:00 de terça em SP
  });
});

describe("ordem de decisão (RN-B5-01): desligado → pausado → fechado por hoje → grade", () => {
  const s = schedule(everyDay([{ start: "00:00", end: "24:00" }]));
  const now = "2026-11-16T22:00:00Z";
  const future = at("2026-11-16T23:00:00Z");

  it("desligar vence a pausa, o fechar-por-hoje e a grade", () => {
    expect(status({ schedule: s, acceptingOrders: false, pausedUntil: future, closedUntil: future }, now)).toMatchObject({ status: "FECHADO", reason: "SWITCHED_OFF", nextOpenAt: null });
  });
  it("pausa vence fechar-por-hoje", () => {
    expect(status({ schedule: s, pausedUntil: future, closedUntil: future }, now).reason).toBe("PAUSED");
  });
  it("fechar por hoje vence a grade aberta", () => {
    expect(status({ schedule: s, closedUntil: future }, now).reason).toBe("CLOSED_TODAY");
  });
  it("controles vencidos não valem", () => {
    const past = at("2026-11-16T21:00:00Z");
    expect(status({ schedule: s, pausedUntil: past, closedUntil: past }, now).status).toBe("ABERTO");
  });
});

describe("CA-B5-06 · exceções por data", () => {
  const week = everyDay([{ start: "18:00", end: "23:00" }]);

  it("fechado dia todo em 25/12: recusa nesse dia e a grade volta no 26", () => {
    const s = schedule(week, { exceptions: [{ date: "2026-12-25", closed: true }] });
    expect(status({ schedule: s }, "2026-12-25T22:00:00Z")).toMatchObject({ status: "FECHADO", reason: "OUTSIDE_HOURS", nextOpenAt: "2026-12-26T21:00:00.000Z" });
    expect(status({ schedule: s }, "2026-12-26T22:00:00Z").status).toBe("ABERTO");
  });

  it("horário especial substitui a grade desse dia (e só dele)", () => {
    const s = schedule(week, { exceptions: [{ date: "2026-12-24", closed: false, intervals: [{ start: "10:00", end: "14:00" }] }] });
    expect(status({ schedule: s }, "2026-12-24T14:00:00Z").status).toBe("ABERTO"); // 11:00
    expect(status({ schedule: s }, "2026-12-24T22:00:00Z").status).toBe("FECHADO"); // 19:00: a grade normal não vale
    expect(status({ schedule: s }, "2026-12-25T22:00:00Z").status).toBe("ABERTO"); // dia seguinte, grade normal
  });

  it("pruneExceptions arquiva datas passadas", () => {
    const s = schedule(week, {
      exceptions: [
        { date: "2026-11-10", closed: true },
        { date: "2026-11-16", closed: true },
        { date: "2026-12-25", closed: true },
      ],
    });
    expect(pruneExceptions(s, at("2026-11-16T15:00:00Z"), SP).exceptions.map((e) => e.date)).toEqual(["2026-11-16", "2026-12-25"]);
  });
});

describe("CA-B5-07 · fuso diferente do servidor", () => {
  it("23:30 local em Tóquio e em São Paulo dão resultados diferentes para o mesmo instante", () => {
    const s = schedule(everyDay([{ start: "18:00", end: "23:45" }]));
    // 14:30Z = 23:30 em Tóquio (UTC+9) = 11:30 em São Paulo
    expect(status({ schedule: s, timezone: "Asia/Tokyo" }, "2026-11-16T14:30:00Z")).toMatchObject({ status: "ABERTO", message: "Aberto até 23:45" });
    expect(status({ schedule: s, timezone: SP }, "2026-11-16T14:30:00Z")).toMatchObject({ status: "FECHADO", message: "Abrimos hoje às 18:00" });
  });

  it("RN-B5-11: mudar o fuso recalcula o estado na hora (mesma grade, mesmo instante)", () => {
    const s = schedule(everyDay([{ start: "09:00", end: "12:00" }]));
    const now = "2026-11-16T13:00:00Z"; // 10:00 em SP, 22:00 em Tóquio
    expect(status({ schedule: s, timezone: SP }, now).status).toBe("ABERTO");
    expect(status({ schedule: s, timezone: "Asia/Tokyo" }, now).status).toBe("FECHADO");
  });
});

describe("sem grade (RN-B5-06) e casos de borda", () => {
  it("sem grade a loja ligada está aberta", () => {
    expect(status({ schedule: null }, "2026-11-16T03:00:00Z")).toMatchObject({ status: "ABERTO", reason: null, nextOpenAt: null });
  });
  it("grade sem nenhum intervalo: fechada, sem próxima abertura", () => {
    expect(status({ schedule: schedule(everyDay([])) }, "2026-11-16T22:00:00Z")).toMatchObject({ status: "FECHADO", reason: "OUTSIDE_HOURS", nextOpenAt: null, message: "Fechado" });
  });
  it("próxima abertura em outro dia usa o dia da semana abreviado", () => {
    const wed = [[], [], [], [{ start: "18:00", end: "22:00" }], [], [], []] as Interval[][];
    expect(status({ schedule: schedule(wed) }, "2026-11-16T15:00:00Z").message).toBe("Abrimos qua às 18:00");
  });
  it("vários intervalos no dia: almoço e jantar", () => {
    const s = schedule(everyDay([{ start: "11:30", end: "15:00" }, { start: "18:00", end: "23:30" }]));
    expect(status({ schedule: s }, "2026-11-16T16:00:00Z")).toMatchObject({ status: "ABERTO", message: "Aberto até 15:00" }); // 13:00, almoço
    expect(status({ schedule: s }, "2026-11-16T18:00:00Z")).toMatchObject({ status: "FECHADO", message: "Abrimos hoje às 18:00" }); // 15:00 em ponto
  });
  it("parseStoredSchedule: formato inesperado vira 'sem grade'", () => {
    expect(parseStoredSchedule(null)).toBeNull();
    expect(parseStoredSchedule("x")).toBeNull();
    expect(parseStoredSchedule({ week: [[]] })).toBeNull();
    expect(parseStoredSchedule({ week: everyDay([]) })).toMatchObject({ cutoffMinutes: 0, exceptions: [] });
  });
});

describe("CA-B5-10 · validação", () => {
  const base = (week: Interval[][], exceptions: Schedule["exceptions"] = []) => schedule(week, { exceptions });

  it("intervalos sobrepostos no mesmo dia apontam o conflito", () => {
    const errors = validateSchedule(base(everyDay([{ start: "11:00", end: "15:00" }, { start: "14:00", end: "18:00" }])));
    expect(errors[0]).toBe("domingo: os horários 11:00-15:00 e 14:00-18:00 se sobrepõem.");
  });
  it("início igual ao fim é recusado; 00:00-24:00 é permitido", () => {
    expect(validateSchedule(base(everyDay([{ start: "10:00", end: "10:00" }])))[0]).toContain("não pode ser igual ao fim");
    expect(validateSchedule(base(everyDay([{ start: "00:00", end: "24:00" }])))).toEqual([]);
  });
  it("horário que passa da meia-noite não pode invadir o dia seguinte", () => {
    const week = [[], [], [], [], [], [{ start: "18:00", end: "03:00" }], [{ start: "02:00", end: "05:00" }]] as Interval[][];
    expect(validateSchedule(base(week)).join(" ")).toContain("sexta: o horário que vai até 03:00 do dia seguinte se sobrepõe ao de sábado");
    const ok = [[], [], [], [], [], [{ start: "18:00", end: "02:00" }], [{ start: "02:00", end: "05:00" }]] as Interval[][];
    expect(validateSchedule(base(ok))).toEqual([]);
  });
  it("exceção com data inválida, repetida ou sem horários é recusada", () => {
    const errors = validateSchedule(
      base(everyDay([]), [
        { date: "2026-02-30", closed: true },
        { date: "2026-12-25", closed: true },
        { date: "2026-12-25", closed: true },
        { date: "2026-12-31", closed: false },
      ]),
    );
    expect(errors).toEqual([
      "Exceção 2026-02-30: data inválida.",
      "Exceção 2026-12-25: data repetida.",
      'Exceção 2026-12-31: informe os horários especiais ou marque "fechado o dia todo".',
    ]);
  });
});
