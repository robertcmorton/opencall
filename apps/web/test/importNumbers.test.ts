import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
// The payload SheetJS needs to WRITE a Numbers file. Reading needs nothing
// extra, which is the point: the importer opens Numbers files like Excel ones.
import XLSX_ZAHL_PAYLOAD from "xlsx/dist/xlsx.zahl.mjs";
import { extractGrid } from "../lib/importExtract";

describe("Apple Numbers import", () => {
  it("reads a .numbers run sheet into the same grid an Excel one gives", async () => {
    const rows = [
      ["TIME", "DURATION", "ITEM"],
      ["7:30 PM", "0:05:00", "Gates open"],
      ["7:35 PM", "10:00", "Anthem"],
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Run sheet");
    const bytes = XLSX.write(wb, { type: "array", bookType: "numbers", numbers: XLSX_ZAHL_PAYLOAD }) as ArrayBuffer;

    const sheet = await extractGrid(new File([bytes], "Match day.numbers"));
    expect(sheet.grid).toEqual(rows);
  });

  it("still refuses a file type it cannot read, and names Numbers among the ones it can", async () => {
    await expect(extractGrid(new File(["x"], "notes.txt"))).rejects.toThrow(/\.numbers/);
  });
});
