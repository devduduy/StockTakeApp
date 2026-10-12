# Debugging Notes - Hero Stock Take

Folder ini berisi catatan penelusuran kode untuk kebutuhan debugging dan onboarding teknis aplikasi Hero Stock Take.

Tujuannya bukan menggantikan dokumentasi user guide, tetapi menjadi peta cepat ketika perlu mencari:

- alur business rule tertentu,
- file frontend/backend/mobile yang terlibat,
- tabel database yang dipakai,
- titik validasi yang menjaga flow bisnis,
- endpoint API yang dilewati web atau mobile.

## Struktur

```text
documentation/debugging/
├── README.md
├── backend/
├── mobile/
└── schedule/
    └── partial-category-scope.md
```

## Catatan yang tersedia

| Modul | Catatan | Fungsi |
| --- | --- | --- |
| Schedule | [partial-category-scope.md](schedule/partial-category-scope.md) | Penelusuran stock type `PARTIAL`, category scope, dan validasi scan item di mobile/backend. |

## Prinsip penelusuran

- Web dan mobile tidak query database langsung.
- Semua validasi data operasional melewati Backend API.
- `MasterData` hanya menjadi sumber master item, barcode, category, division, department, dan location.
- Guardrail penting tetap ditempatkan di backend, walaupun UI juga punya validasi.

