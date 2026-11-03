import { describe, expect, it } from "bun:test";
import { batches, guessMapping, mapRows, parseCsv } from "../lib/csv-import";

describe("parseCsv", () => {
	it("handles quotes, commas, escaped quotes and CRLF", () => {
		const rows = parseCsv(
			'﻿Name,Email,Notes\r\n"Reyes, Dana",dana@x.test,"Said ""call me"" in May"\r\n\r\nTom,tom@x.test,\n',
		);
		expect(rows).toEqual([
			["Name", "Email", "Notes"],
			["Reyes, Dana", "dana@x.test", 'Said "call me" in May'],
			["Tom", "tom@x.test", ""],
		]);
	});

	it("keeps newlines inside quoted fields", () => {
		expect(parseCsv('a,b\n"line one\nline two",2')).toEqual([
			["a", "b"],
			["line one\nline two", "2"],
		]);
	});
});

describe("guessMapping", () => {
	it("recognises the headers spreadsheets and CRMs export", () => {
		const mapping = guessMapping([
			"First Name",
			"Last_Name",
			"E-mail",
			"Company Name",
			"Deal Stage",
			"Amount",
			"Last Contacted",
			"Favourite colour",
		]);
		expect(mapping.firstName).toBe(0);
		expect(mapping.lastName).toBe(1);
		expect(mapping.email).toBe(2);
		expect(mapping.companyName).toBe(3);
		expect(mapping.dealStage).toBe(4);
		expect(mapping.dealAmount).toBe(5);
		expect(mapping.lastContactedAt).toBe(6);
		expect(mapping.notes).toBeNull();
	});
});

describe("mapRows", () => {
	it("drops blanks and unmapped columns", () => {
		const mapping = guessMapping(["Email", "Name", "Other"]);
		expect(mapRows([[" a@x.test ", "", "z"]], mapping)).toEqual([
			{ email: "a@x.test" },
		]);
	});
});

describe("batches", () => {
	it("splits evenly with a remainder", () => {
		expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
	});
});
