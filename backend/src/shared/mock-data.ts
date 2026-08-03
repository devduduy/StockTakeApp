import bcrypt from "bcryptjs";

export const mockUsers = [
  {
    id: "1",
    username: "scanner01",
    passwordHash: bcrypt.hashSync("prototype", 12),
    fullName: "YUDHA PERMANA",
    roleId: 4,
    roleCode: "SCANNER",
    roleName: "Scanner",
    locCode: "6168",
    status: "ACTIVE",
  },
];

export const mockSchedules = [
  {
    id: "1",
    scheduleNo: "ST/2026/07/001",
    scheduleDesc: "Stock Take Prototype - Fresh Food",
    locCode: "6168",
    locationName: "HERO SUPERMARKET 6168",
    scheduleDate: "2026-07-29",
    startTime: "2026-07-29T08:00:00.000Z",
    endTime: null,
    stockTypeId: 1,
    stockTypeCode: "STOCK_ALL",
    stockTypeName: "ALL",
    stockTypeValue: "ALL",
    categoryId: null,
    status: "OPEN",
  },
];

export const mockRacks = [
  {
    id: "1",
    rackCode: "RCK-FF-A101",
    rackName: "Rack A1-01",
    locCode: "6168",
    status: "ACTIVE",
  },
  {
    id: "2",
    rackCode: "RCK-FF-A102",
    rackName: "Rack A1-02",
    locCode: "6168",
    status: "ACTIVE",
  },
  {
    id: "3",
    rackCode: "RCK-FF-A103",
    rackName: "Rack A1-03",
    locCode: "6168",
    status: "ACTIVE",
  },
];

export const mockItems = [
  {
    barcode: "383800000013",
    plu: "0000001",
    pluDescription: "GROCERY NO TAX",
    category: { id: "10101", name: "BREAKFAST FOOD" },
    erpQty: 0,
    source: "MOCK",
  },
  {
    barcode: "8990123456789",
    plu: "100234",
    pluDescription: "Apple Fuji 500g",
    category: { id: "40601", name: "SEAFOOD" },
    erpQty: 120,
    source: "MOCK",
  },
  {
    barcode: "8994567890123",
    plu: "100245",
    pluDescription: "Orange Navel",
    category: { id: "40601", name: "SEAFOOD" },
    erpQty: 80,
    source: "MOCK",
  },
  {
    barcode: "100234",
    plu: "100234",
    pluDescription: "Apple Fuji 500g",
    category: { id: "40601", name: "SEAFOOD" },
    erpQty: 120,
    source: "MOCK",
  },
  {
    barcode: "100245",
    plu: "100245",
    pluDescription: "Orange Navel",
    category: { id: "40601", name: "SEAFOOD" },
    erpQty: 80,
    source: "MOCK",
  },
];

export interface MockScanSubmission {
  clientScanId: string;
  scheduleId: string;
  scheduleNo: string;
  rackId: string;
  rackCode: string;
  barcode: string;
  plu: string;
  pluDescription: string;
  scanQty: number;
  inputType: "SCAN" | "MANUAL";
  scanStatus: "SYNCED";
  userCreated: string;
  dateCreated: string;
  userModified?: string;
  dateModified?: string;
}

export const mockScanSubmissions: MockScanSubmission[] = [];
