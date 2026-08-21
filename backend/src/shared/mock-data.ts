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
  {
    id: "2",
    username: "store_manager01",
    passwordHash: bcrypt.hashSync("prototype", 12),
    fullName: "STORE MANAGER HERO 6168",
    roleId: 2,
    roleCode: "STORE_MANAGER",
    roleName: "Store Manager",
    locCode: "6168",
    status: "ACTIVE",
  },
  {
    id: "3",
    username: "inventory_control01",
    passwordHash: bcrypt.hashSync("prototype", 12),
    fullName: "INVENTORY CONTROL HERO",
    roleId: 1,
    roleCode: "INVENTORY_CONTROL",
    roleName: "Inventory Control",
    locCode: "0000",
    status: "ACTIVE",
  },
];

export interface MockSchedule {
  id: string;
  scheduleNo: string;
  scheduleDesc: string;
  locCode: string;
  locationName: string;
  scheduleDate: string;
  endDate: string;
  cutOffDate: string;
  startTime: string | null;
  endTime: string | null;
  stockTypeId: number;
  stockTypeCode: string;
  stockTypeName: string;
  stockTypeValue: string | null;
  categoryId: string | null;
  status: string;
}

export const mockSchedules: MockSchedule[] = [
  {
    id: "1",
    scheduleNo: "ST/2026/07/001",
    scheduleDesc: "Stock Take Prototype - Fresh Food",
    locCode: "6168",
    locationName: "HERO SUPERMARKET 6168",
    scheduleDate: "2026-07-29",
    endDate: "2026-07-29",
    cutOffDate: "2026-07-29",
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
    rackCode: "RCK-FF-101",
    rackName: "Rack A1-01",
    locCode: "6168",
    status: "ACTIVE",
  },
  {
    id: "2",
    rackCode: "RCK-FF-102",
    rackName: "Rack A1-02",
    locCode: "6168",
    status: "ACTIVE",
  },
  {
    id: "3",
    rackCode: "RCK-FF-103",
    rackName: "Rack A1-03",
    locCode: "6168",
    status: "ACTIVE",
  },
];

export interface MockScheduleRack {
  scheduleId: string;
  rackId: string;
  rackCode: string;
  rackName: string;
  locCode: string;
  status: string;
}

export const mockScheduleRacks: MockScheduleRack[] = mockRacks.map((rack) => ({
  scheduleId: "1",
  rackId: rack.id,
  rackCode: rack.rackCode,
  rackName: rack.rackName,
  locCode: rack.locCode,
  status: "ACTIVE",
}));

export interface MockScheduleUser {
  scheduleId: string;
  userId: string;
  status: string;
  userCreated?: string;
  dateCreated?: string;
  userModified?: string;
  dateModified?: string;
}

export const mockScheduleUsers: MockScheduleUser[] = [];

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
  finalQty?: number;
  inputType: "SCAN" | "MANUAL";
  scanStatus: "SYNCED" | "REJECTED";
  printNo?: string;
  recheckUser?: string;
  confirmUser?: string;
  confirmTime?: string;
  userCreated: string;
  dateCreated: string;
  userModified?: string;
  dateModified?: string;
}

export const mockScanSubmissions: MockScanSubmission[] = [];
