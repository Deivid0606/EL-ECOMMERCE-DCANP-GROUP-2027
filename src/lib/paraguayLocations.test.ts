import { describe, expect, it } from "vitest";
import { buildPlatformCoverageLocations } from "./paraguayLocations";

describe("Cobertura automática de Mi Tienda", () => {
  it("incluye ciudades nuevas que todavía no existen en la lista fija", () => {
    const result = buildPlatformCoverageLocations([
      { departamento: "Central", city: "Ciudad Nueva de Prueba" },
      { departamento: "Central", city: "San Lorenzo" },
    ]);
    const central = result.find(d => d.department === "Central");
    expect(central?.cities).toContain("Ciudad Nueva de Prueba");
    expect(central?.cities).toContain("San Lorenzo");
  });

  it("normaliza Asunción aunque se registre bajo Central", () => {
    const result = buildPlatformCoverageLocations([
      { departamento: "Central", city: "Asuncion" },
    ]);
    expect(result.find(d => d.department === "Asunción")?.cities).toEqual(["Asunción"]);
  });

  it("evita duplicados por acentos, espacios o mayúsculas y conserva departamentos nuevos", () => {
    const result = buildPlatformCoverageLocations([
      { departamento: "Central", city: "Ypane" },
      { departamento: "CENTRAL ", city: " Ypané " },
      { departamento: "Departamento nuevo", city: "Ciudad única" },
      { departamento: "Departamento nuevo", city: " ciudad unica " },
    ]);
    expect(result.find(d => d.department === "Central")?.cities).toEqual(["Ypané"]);
    expect(result.find(d => d.department === "Departamento nuevo")?.cities).toEqual(["Ciudad única"]);
  });

  it("omite filas incompletas", () => {
    expect(buildPlatformCoverageLocations([
      { departamento: "", city: "Sin departamento" },
      { departamento: "Central", city: "" },
    ])).toEqual([]);
  });
});
