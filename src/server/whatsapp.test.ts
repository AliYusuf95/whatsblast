import { describe, test, expect } from "bun:test";
import { constructMessage } from "./whatsapp";

describe("constructMessage", () => {
  test("should handle regular messages without data", () => {
    const message = ["Hello", " ", "World"];
    expect(constructMessage(message)).toBe("Hello World");
  });

  test("should handle template messages with data", () => {
    const message = ["Dear ", 0, ",\nWelcome to ", 1, "!"];
    const data = ["John", "Company"];
    expect(constructMessage(message, data)).toBe(
      "Dear John,\nWelcome to Company!"
    );
  });

  test("should handle missing data values", () => {
    const message = ["Hello ", 0, " ", 1, "!"];
    const data = ["John"];
    expect(constructMessage(message, data)).toBe("Hello John !");
  });

  test("should handle empty data array", () => {
    const message = ["Hello ", 0, "!"];
    const data: string[] = [];
    expect(constructMessage(message, data)).toBe("Hello !");
  });

  test("should handle complex template with multiple data references", () => {
    const message = [
      "Dear ",
      0,
      ",\n\nThank you for your order #",
      1,
      ".\nYour total is $",
      2,
      ".\n\nBest regards,\n",
      3,
    ];
    const data = ["John", "12345", "99.99", "Sales Team"];
    expect(constructMessage(message, data)).toBe(
      "Dear John,\n\nThank you for your order #12345.\nYour total is $99.99.\n\nBest regards,\nSales Team"
    );
  });

  test("should handle template with repeated data references", () => {
    const message = ["Hello ", 0, "! How are you ", 0, "?"];
    const data = ["John"];
    expect(constructMessage(message, data)).toBe(
      "Hello John! How are you John?"
    );
  });
});
