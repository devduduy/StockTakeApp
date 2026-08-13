HASIL DEMO STOCK TAKE
NOTES:
-(DONE) jika schedule Partial urutan UI adalah section category dulu - setelah itu section rack 
-(DONE) lokasi di create schedule bisa pencarian di ui kayak searchable dropdown 
-(DONE) di mobile tambah rules validasi boleh mulai stock take selama rentang berdasarkan tgl periode stock take nya 
-(DONE) list item di web di order by sequence secara ascending (sama dengan hasil print nya) 
-(DONE) pewarnaan ui status rack disesuaikan, belum scan merah - sudah submit biru - sudah print kuning - confim hijau 
-(DONE) tambah field tanggal cut off SOH di create schedule setelah input tanggal selesai (create kolom di table berarti) 
-(DONE) penamaan deskripsi bukan input manual melainkan hasil format generate {STOCK TAKE {kode lokasi} {tipe} {YYYY-MM-DD (tgl cutoff)} 
-(DONE) di kertas print, waktu scan tidak perlu, tambah 1 kolom notes untuk catatan, kolom qty kasih pilihan visible invisible, no rack bold dan besar 

-tambah button print di list rack yang siap print (fungsi sama dengan yang di dalam)
-UI button simpan koreksi berdiri sendiri, mepetin ke kiri, button reject & confirm justify center agak kecil
-tambah checkbox di list rack for easy selected bulk to confirm, button confirm diluar (confirm bulk dan confirm per rack), label sudah di koreksi untuk rack yang sudah dikoreksi
-modify dashboard rack di schedule dari kiri kekanan adalah card = total rack, belum scan, sudah submit, sudah print, sudah koreksi, confirm (semua itu berikut persenan nya jadi agar terlihat dari total rack 100% itu keliatan persenan-persenan lainnya ada proses apa aja)
-schedule boleh di close ketika semua rack confirm & sudah print report berita acara stok take (buat close schedule nya dulu aja dan validasi rack sudah confirm semua, validasi report nya nanti aja karena report masih belum)
-pencarian rack di partial, cari hal mudah agar user tidak klik banyak satu-satu
-buat menu baru yang isinya adalah list schedule yang udah selesai/close tujuannya dipisah karena schedule sekarang dalam bentuk card cocok untuk schedule yang aktif saja, dalam bentuk data table berikut filter dan pencariannya

--new requirement
-create master template category : 
	fresh monthly => fresh exclude dairy & frozen, food service all, non trade all
	custom => all category show