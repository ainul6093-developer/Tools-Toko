/* =========================================
   TOOLS TOKO - DATA EXPIRED
   Autocomplete berindeks + rak dari Stok Toko
   Input multi-baris dengan satu kali simpan
========================================= */
(function () {
    "use strict";

    const EXPIRED_DB = "ToolsTokoExpiredDB";
    const EXPIRED_STORE = "dataExpired";
    const PRODUCT_DB = "ToolsTokoDB";
    const PRODUCT_STORE = "masterProduk";
    const STOCK_DB = "ToolsTokoStockDB";
    const STOCK_STORE = "stokToko";
    const MONTHS = [
        "Januari", "Februari", "Maret", "April", "Mei", "Juni",
        "Juli", "Agustus", "September", "Oktober", "November", "Desember"
    ];
    const MAX_SUGGESTIONS = 8;

    const state = {
        db: null,
        records: [],
        products: [],
        codeIndex: new Map(),
        firstCharIndex: new Map(),
        stockIndex: new Map(),
        lookupLoaded: false,
        lookupLoading: null,
        selectedProduct: null,
        selectedRack: "",
        editingRecord: null,
        drafts: [],
        scanMode: false,
        cameraStream: null,
        cameraDetector: null,
        cameraActive: false,
        cameraFrame: 0
    };

    const el = id => document.getElementById(id);

    function renderScanButton(label = "Scan") {
        const button = el("scanExpiredBarcode");
        if (!button) return;
        button.innerHTML =
            '<svg class="expired-scan-icon" viewBox="0 0 24 24" ' +
            'aria-hidden="true" focusable="false">' +
            '<path d="' +
            'M4 8V5a1 1 0 0 1 1-1h3' +
            'M16 4h3a1 1 0 0 1 1 1v3' +
            'M20 16v3a1 1 0 0 1-1 1h-3' +
            'M8 20H5a1 1 0 0 1-1-1v-3' +
            '"/>' +
            '</svg>' +
            `<span class="expired-scan-label">${label}</span>`;
        button.setAttribute("aria-label", label === "Scan" ? "Scan barcode" : label);
    }

    function normalizeCode(value) {
        return String(value ?? "").trim().replace(/\s+/g, "");
    }

    function normalizeText(value) {
        return String(value ?? "").toLocaleLowerCase("id-ID").trim();
    }

    function openDatabase(name, version, setup) {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(name, version);
            request.onupgradeneeded = () => {
                if (typeof setup === "function") setup(request.result);
            };
            request.onsuccess = () => {
                const db = request.result;
                db.onversionchange = () => db.close();
                resolve(db);
            };
            request.onerror = () =>
                reject(request.error || new Error("Database tidak dapat dibuka."));
        });
    }

    function openProductDatabase() {
        return openDatabase(PRODUCT_DB, 1, db => {
            if (!db.objectStoreNames.contains(PRODUCT_STORE)) {
                const store = db.createObjectStore(PRODUCT_STORE, { keyPath: "kode" });
                store.createIndex("nama", "nama", { unique: false });
            }
        });
    }

    function openStockDatabase() {
        return openDatabase(STOCK_DB, 1, db => {
            if (!db.objectStoreNames.contains("stokToko")) {
                db.createObjectStore("stokToko", { keyPath: "id", autoIncrement: true });
            }
            if (!db.objectStoreNames.contains("stokGudang")) {
                db.createObjectStore(
                    "stokGudang",
                    { keyPath: "id", autoIncrement: true }
                );
            }
        });
    }

    function openExpiredDatabase() {
        return openDatabase(EXPIRED_DB, 1, db => {
            if (!db.objectStoreNames.contains(EXPIRED_STORE)) {
                const store = db.createObjectStore(
                    EXPIRED_STORE,
                    { keyPath: "id", autoIncrement: true }
                );
                store.createIndex("barcode", "barcode", { unique: false });
                store.createIndex("tahunBulan", "tahunBulan", { unique: false });
            }
        });
    }

    function readAll(db, storeName) {
        return new Promise((resolve, reject) => {
            if (!db.objectStoreNames.contains(storeName)) {
                resolve([]);
                return;
            }
            const tx = db.transaction(storeName, "readonly");
            const request = tx.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error || tx.error);
        });
    }

    async function loadLookupIndexes(force = false) {
        if (state.lookupLoaded && !force) return;
        if (state.lookupLoading) return state.lookupLoading;

        state.lookupLoading = (async () => {
            setLookupMessage("Menyiapkan indeks pencarian produk dan rak toko...");
            const [productDb, stockDb] = await Promise.all([
                openProductDatabase(), openStockDatabase()
            ]);

            let products = [];
            let stockRows = [];
            try {
                [products, stockRows] = await Promise.all([
                    readAll(productDb, PRODUCT_STORE),
                    readAll(stockDb, STOCK_STORE)
                ]);
            } finally {
                productDb.close();
                stockDb.close();
            }

            state.products = products.filter(p => normalizeCode(p.kode));
            state.codeIndex = new Map();
            state.firstCharIndex = new Map();
            state.stockIndex = new Map();

            // Peta barcode langsung untuk pencarian hasil scan.
            for (const product of state.products) {
                const code = normalizeCode(product.kode);
                if (code && !state.codeIndex.has(code)) {
                    state.codeIndex.set(normalizeText(code), product);
                }
            }

            // Indeks kandidat berdasarkan karakter awal barcode atau kata nama.
            // Pencarian tiap ketikan hanya memeriksa bucket terkait, bukan semua produk.
            for (const product of state.products) {
                const code = normalizeCode(product.kode);
                const name = normalizeText(product.nama);
                const keys = new Set();
                if (code) keys.add(code[0]);
                name
                    .split(/[^\p{L}\p{N}]+/u)
                    .filter(Boolean)
                    .forEach(token => keys.add(token[0]));
                keys.forEach(key => {
                    if (!state.firstCharIndex.has(key)) state.firstCharIndex.set(key, []);
                    state.firstCharIndex.get(key).push(product);
                });
            }

            // Rak hanya dibaca dari dataset Stok Toko.
            for (const row of stockRows) {
                const code = normalizeCode(
                    row.KODE ?? row.kode ?? row.BARCODE ?? row.barcode
                );
                if (!code) continue;
                const rack = String(row.RAK ?? row.rak ?? "").trim();
                if (rack && !state.stockIndex.has(code)) {
                    state.stockIndex.set(code, {
                        rak: rack,
                        stok: row.STOK ?? row.stok ?? ""
                    });
                }
            }

            state.lookupLoaded = true;
            if (!state.products.length) {
                setLookupMessage(
                    "Master Produk belum tersedia. Unggah data Master Produk " +
                    "terlebih dahulu.",
                    true
                );
            } else if (!stockRows.length) {
                setLookupMessage(
                    "Indeks Master Produk siap. Stok Toko belum tersedia; " +
                    "kolom rak akan ditandai jika tidak ditemukan."
                );
            } else {
                setLookupMessage(
                    `${state.products.length.toLocaleString("id-ID")} produk dan ` +
                    `${stockRows.length.toLocaleString("id-ID")} data Stok Toko ` +
                    "siap dicari."
                );
            }
        })().catch(error => {
            state.lookupLoaded = false;
            setLookupMessage(
                "Data referensi belum dapat dibaca: " +
                (error.message || "kesalahan database."),
                true
            );
            throw error;
        }).finally(() => {
            state.lookupLoading = null;
        });

        return state.lookupLoading;
    }

    window.invalidateExpiredLookups = function () {
        state.lookupLoaded = false;
        state.lookupLoading = null;
    };

    function setLookupMessage(message, isError = false) {
        const node = el("expiredLookupStatus");
        if (!node) return;
        node.textContent = message;
        node.classList.toggle("is-error", !!isError);
    }

    function findProducts(query) {
        const q = normalizeText(query);
        if (!q) return [];
        const exactCode = state.codeIndex.get(normalizeText(normalizeCode(query)));
        if (exactCode) return [exactCode];

        const bucket = state.firstCharIndex.get(q[0]) || [];
        const results = [];
        for (const product of bucket) {
            const code = normalizeCode(product.kode);
            const name = normalizeText(product.nama);
            const tokenMatch = name
                .split(/[^\p{L}\p{N}]+/u)
                .some(token => token.startsWith(q));
            if (
                code.toLocaleLowerCase("id-ID").startsWith(q) ||
                tokenMatch ||
                name.startsWith(q)
            ) {
                results.push(product);
                if (results.length >= MAX_SUGGESTIONS) break;
            }
        }
        return results;
    }

    function renderAutocomplete() {
        const input = el("expiredProductSearch");
        const list = el("expiredAutocomplete");
        if (!input || !list) return;
        const query = input.value.trim();
        list.innerHTML = "";

        if (!query) {
            list.hidden = true;
            return;
        }

        const items = findProducts(query);
        if (!items.length) {
            const empty = document.createElement("div");
            empty.className = "expired-autocomplete-empty";
            empty.textContent = state.products.length
                ? "Barang tidak ditemukan."
                : "Data Master Produk belum dimuat.";
            list.appendChild(empty);
            list.hidden = false;
            return;
        }

        for (const product of items) {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "expired-autocomplete-option";
            const code = document.createElement("strong");
            code.textContent = normalizeCode(product.kode);
            const name = document.createElement("span");
            name.textContent = String(product.nama || "Nama barang tidak tersedia");
            button.append(code, document.createTextNode(" : "), name);
            button.addEventListener("pointerdown", event => event.preventDefault());
            button.addEventListener("click", () => selectProduct(product));
            list.appendChild(button);
        }
        list.hidden = false;
    }

    function selectProduct(product, fallbackRack = "") {
        state.selectedProduct = product;
        const code = normalizeCode(product.kode);
        const stock = state.stockIndex.get(code);
        const rack = String(fallbackRack || stock?.rak || "").trim();
        const name = String(product.nama || "");
        state.selectedRack = rack;

        el("expiredSelectedBarcode").value = code;
        el("expiredSelectedName").value = name;
        el("expiredSelectedRack").value = rack;

        const resultCard = el("expiredLookupResult");
        if (resultCard) {
            el("expiredLookupResultBarcode").textContent = code;
            el("expiredLookupResultRack").textContent = rack;
            el("expiredLookupResultName").textContent =
                name || "Nama barang tidak tersedia";
            resultCard.hidden = false;
        }

        el("expiredProductSearch").value = `${code} : ${name}`;
        el("expiredProductSearch").placeholder = "Ketik nama barang...";
        el("expiredAutocomplete").hidden = true;

        if (rack) {
        setLookupMessage(`Barang dipilih. Rak ${rack} digunakan pada form.`);
        } 
        
        else {
        setLookupMessage("");
        }

        state.scanMode = false;
        el("scanExpiredBarcode").classList.remove("is-scanning");
        renderScanButton("Scan");
    }

    function clearSelectedProduct() {
        state.selectedProduct = null;
        state.selectedRack = "";
        el("expiredSelectedBarcode").value = "";
        el("expiredSelectedName").value = "";
        el("expiredSelectedRack").value = "";
        const resultCard = el("expiredLookupResult");
        if (resultCard) resultCard.hidden = true;
        el("expiredProductSearch").value = "";
        el("expiredProductSearch").placeholder = "Ketik nama barang...";
        el("expiredMonth").value = "";
        el("expiredAutocomplete").hidden = true;
    }

    function formatMonthYear(month, year) {
        const monthIndex = Number(month) - 1;
        if (monthIndex < 0 || monthIndex > 11 || !year) return "—";
        return `${MONTHS[monthIndex]} ${year}`;
    }

    function getMonthsUntilExpiry(record, now = new Date()) {
        const month = Number(record.bulan);
        const year = Number(record.tahun);

        if (
            !Number.isInteger(month) || month < 1 || month > 12 ||
            !Number.isInteger(year) || year < 2000 || year > 2100
        ) {
            return null;
        }

        const currentMonth = now.getFullYear() * 12 + now.getMonth();
        const expiryMonth = year * 12 + (month - 1);

        return expiryMonth - currentMonth;
    }


function getKeterangan(record, now = new Date()) {
    const monthsUntilExpiry = getMonthsUntilExpiry(record, now);

    if (monthsUntilExpiry === null) {
        return "—";
    }

    if (monthsUntilExpiry > 0) {
        return `- ${monthsUntilExpiry} Bulan`;
    }

    if (monthsUntilExpiry < 0) {
        return `+ ${Math.abs(monthsUntilExpiry)} Bulan`;
    }

    return "Bulan Ini";
}

  

function getExecutionLeadMonths(record) {
    const execution = String(record.eksekusi || "- 1 Bulan");
    const match = execution.match(/(?:H\s*)?-\s*(\d+)\s*bulan/i);
    const months = match ? Number(match[1]) : 1;

    return Number.isInteger(months) && months > 0 ? months : 1;
}

  
    function getStatus(record, now = new Date()) {
        const monthsUntilExpiry = getMonthsUntilExpiry(record, now);

        if (monthsUntilExpiry === null) {
            return {
                label: "Perlu Eksekusi / Update",
                className: "expired-status-warning"
            };
        }

        // Jika bulan expired sudah tiba atau terlewati, harus segera diperbarui.
        if (monthsUntilExpiry <= 0) {
            return {
                label: "Harus Eksekusi /\nUpdate Sekarang",
                className: "expired-status-urgent"
            };
        }

        // Setiap produk mengikuti batas eksekusi yang dipilih pada form input.
        if (monthsUntilExpiry <= getExecutionLeadMonths(record)) {
            return {
                label: "Perlu Eksekusi / Update",
                className: "expired-status-warning"
            };
        }

        return {
            label: "Aman",
            className: "expired-status-safe"
        };
    }

    function getRecordKey(record) {
        const barcode = normalizeCode(record.barcode);
        const month = Number(record.bulan);
        const year = Number(record.tahun);
        if (
            !barcode || !Number.isInteger(month) || month < 1 || month > 12 ||
            !Number.isInteger(year) || year < 2000 || year > 2100
        ) {
            return null;
        }
        return `${barcode}|${year}-${String(month).padStart(2, "0")}`;
    }

    async function deleteRecordIds(db, ids) {
        if (!ids.length) return;

        await new Promise((resolve, reject) => {
            const tx = db.transaction(EXPIRED_STORE, "readwrite");
            const store = tx.objectStore(EXPIRED_STORE);
            ids.forEach(id => store.delete(id));
            tx.oncomplete = resolve;
            tx.onerror = () => reject(
                tx.error || new Error("Data ganda tidak dapat dibersihkan.")
            );
            tx.onabort = () => reject(
                tx.error || new Error("Pembersihan data ganda dibatalkan.")
            );
        });
    }

    async function keepLatestRecords(db, records) {
        // ID IndexedDB auto-increment terbesar adalah input yang paling baru.
        const latestFirst = [...records].sort(
            (a, b) => Number(b.id || 0) - Number(a.id || 0)
        );
        const seenKeys = new Set();
        const uniqueRecords = [];
        const duplicateIds = [];

        latestFirst.forEach(record => {
            const key = getRecordKey(record);
            if (key && seenKeys.has(key)) {
                if (record.id !== undefined) duplicateIds.push(record.id);
                return;
            }
            if (key) seenKeys.add(key);
            uniqueRecords.push(record);
        });

        // Bersihkan juga dari IndexedDB agar data lama tidak muncul kembali
        // setelah satu data dihapus atau halaman dimuat ulang.
        await deleteRecordIds(db, duplicateIds);
        return uniqueRecords;
    }

    function renderRecords() {
        const body = el("expiredTableBody");
        if (!body) return;
        const query = normalizeText(el("expiredSearch")?.value || "");
        const currentDate = new Date();
        const filtered = state.records.filter(record => {
            if (!query) return true;
            const status = getStatus(record, currentDate).label;
            return [
                record.barcode,
                record.nama,
                record.rak,
                formatMonthYear(record.bulan, record.tahun),
                getKeterangan(record, currentDate),
                record.eksekusi || "H - 1 Bulan",
                status
            ]
                .some(value => normalizeText(value).includes(query));
        });

        body.innerHTML = "";
        if (!filtered.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 7;
            cell.className = "expired-empty-cell";
            cell.textContent = state.records.length
                    ? "Data tidak ditemukan."
                    : "Belum ada data expired.";
            row.appendChild(cell);
            body.appendChild(row);
        } else {
            filtered.forEach(record => {
                const row = document.createElement("tr");
                addCell(row, record.barcode);
                addCell(row, record.nama);
                addCell(row, record.rak, true);
                addCell(row, formatMonthYear(record.bulan, record.tahun));
                // Keterangan dihitung dari bulan expired dibanding bulan perangkat.
                addCell(row, getKeterangan(record, currentDate));

                const statusCell = document.createElement("td");
                const badge = document.createElement("span");
                const status = getStatus(record, currentDate);
                badge.className = `expired-status-badge ${status.className}`;
                badge.textContent = status.label;
                statusCell.className = "expired-status-cell";
                statusCell.appendChild(badge);
                bindStatusDeleteGesture(statusCell, record);
                row.appendChild(statusCell);

                const actionCell = document.createElement("td");
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.className = "expired-edit-button";
                editButton.textContent = "Edit";
                editButton.setAttribute(
                    "aria-label",
                    `Edit data expired ${record.nama || record.barcode}`
                );
                editButton.addEventListener("click", () => openEditModal(record));
                actionCell.appendChild(editButton);
                row.appendChild(actionCell);

                body.appendChild(row);
            });
        }
        const count = el("expiredRecordCount");
        if (count) count.textContent = `${filtered.length.toLocaleString("id-ID")} data`;
    }


function addCell(row, value, blankWhenEmpty = false) {
    const cell = document.createElement("td");
    const text = String(value ?? "").trim();

    if (blankWhenEmpty) {
        const placeholderValues = [
            "",
            "—",
            "-",
            "rak tidak ditemukan"
        ];

        const normalizedText = text.toLocaleLowerCase("id-ID");

        cell.textContent = placeholderValues.includes(normalizedText)
            ? ""
            : text;
    } else {
        cell.textContent = text || "—";
    }

    row.appendChild(cell);
}

  
    async function loadRecords() {
        if (!state.db) state.db = await openExpiredDatabase();
        const records = await readAll(state.db, EXPIRED_STORE);
        state.records = await keepLatestRecords(state.db, records);
        renderRecords();
    }

    function openModal() {
        const modal = el("expiredModal");
        state.editingRecord = null;
        state.drafts = [];
        modal.classList.remove("is-editing");
        el("expiredModalTitle").textContent = "Tambah Data Expired";
        el("expiredModalDescription").textContent =
            "Tambahkan beberapa barang, lalu simpan sekaligus.";
        el("expiredOkBtn").textContent = "Oke";
        el("expiredOkBtn").disabled = false;
        el("saveExpiredBatch").hidden = false;

        clearSelectedProduct();
        const currentYear = new Date().getFullYear();
        el("expiredMonth").value = "";
        el("expiredYear").value = String(currentYear);
        el("expiredExecution").value = "- 1 Bulan";
        const resultCard = el("expiredLookupResult");
        if (resultCard) resultCard.hidden = true;
        state.scanMode = false;
        el("scanExpiredBarcode").classList.remove("is-scanning");
        renderScanButton("Scan");
        setLookupMessage("Menyiapkan indeks pencarian produk dan rak toko...");
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        renderDrafts();
        loadLookupIndexes().then(() => {
            if (state.products.length) el("expiredProductSearch").focus();
        }).catch(() => {});
    }

    function openEditModal(record) {
        stopCameraScanner();
        state.drafts = [];
        state.editingRecord = record;

        const modal = el("expiredModal");
        modal.classList.add("is-editing");
        el("expiredModalTitle").textContent = "Edit Data Expired";
        el("expiredModalDescription").textContent =
            "Perbarui tanggal expired atau perintah eksekusi produk ini.";
        el("expiredOkBtn").textContent = "Simpan";
        el("saveExpiredBatch").hidden = true;

        clearSelectedProduct();
        selectProduct(
            {
                kode: record.barcode,
                nama: record.nama
            },
            record.rak || ""
        );
        el("expiredMonth").value = String(record.bulan || "");
        el("expiredYear").value = String(record.tahun || new Date().getFullYear());
        el("expiredExecution").value =
            /- 2 Bulan/i.test(record.eksekusi || "")
            ? "- 2 Bulan"
            : "- 1 Bulan";
        setLookupMessage("Data produk otomatis diambil dari baris yang dipilih.");

        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        renderDrafts();
    }

    function closeModal() {
        stopCameraScanner();
        const modal = el("expiredModal");
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        modal.classList.remove("is-editing");
        state.drafts = [];
        state.selectedProduct = null;
        state.selectedRack = "";
        state.editingRecord = null;
        state.scanMode = false;
        el("saveExpiredBatch").hidden = false;
        el("expiredOkBtn").textContent = "Oke";
        el("expiredOkBtn").disabled = false;
    }

    function addDraft() {
        const product = state.selectedProduct;
        const month = Number(el("expiredMonth").value);
        const year = Number(el("expiredYear").value);
        if (!product) {
            setLookupMessage(
                "Pilih barang dari dropdown pencarian atau pindai barcode " +
                "terlebih dahulu.",
                true
            );
            el("expiredProductSearch").focus();
            return;
        }
        if (!month) {
            setLookupMessage("Pilih bulan expired terlebih dahulu.", true);
            return;
        }
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            setLookupMessage("Tahun expired harus antara 2000 sampai 2100.", true);
            el("expiredYear").focus();
            return;
        }

        const barcode = normalizeCode(product.kode);
        const stock = state.stockIndex.get(barcode);
        const execution = el("expiredExecution").value || "- 1 Bulan";
        const key = getRecordKey({ barcode, bulan: month, tahun: year });
        const existingDraftIndex = state.drafts.findIndex(
            draft => getRecordKey(draft) === key
        );
        const existsInSaved = state.records.some(
            record => getRecordKey(record) === key
        );

        // Jika kombinasi barcode + bulan + tahun yang sama dimasukkan lagi,
        // input terbaru menggantikan draft lama atau data tersimpan saat disimpan.
        if (existingDraftIndex !== -1) {
            state.drafts.splice(existingDraftIndex, 1);
        }
        state.drafts.push({
            draftId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            barcode,
            nama: String(product.nama || ""),
            rak: state.selectedRack || stock?.rak || "",
            bulan: month,
            tahun: year,
            eksekusi: execution
        });
        renderDrafts();
        clearSelectedProduct();
        setLookupMessage(
            existsInSaved || existingDraftIndex !== -1
                ? "Input terbaru menggantikan data dengan barcode, bulan, dan tahun expired yang sama."
                : `Data ditambahkan ke daftar sementara (${state.drafts.length}).`
        );
        el("expiredProductSearch").focus();
    }

    function renderDrafts() {
        const body = el("expiredDraftTableBody");
        if (!body) return;
        body.innerHTML = "";
        if (!state.drafts.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 5;
            cell.className = "expired-empty-cell";
            cell.textContent = "Belum ada barang di daftar simpan.";
            row.appendChild(cell);
            body.appendChild(row);
        } else {
            state.drafts.forEach(draft => {
                const row = document.createElement("tr");
                addCell(row, draft.barcode);
                addCell(row, draft.nama);
                addCell(row, draft.rak, true);
                addCell(row, formatMonthYear(draft.bulan, draft.tahun));
                const action = document.createElement("td");
                const remove = document.createElement("button");
                remove.type = "button";
                remove.className = "expired-delete-button";
                remove.textContent = "×";
                remove.setAttribute(
                    "aria-label",
                    `Hapus ${draft.nama || draft.barcode} dari daftar input`
                );
                remove.title = "Hapus dari daftar input";
                remove.addEventListener("click", () => {
                    state.drafts = state.drafts.filter(
                        item => item.draftId !== draft.draftId
                    );
                    renderDrafts();
                });
                action.appendChild(remove);
                row.appendChild(action);
                body.appendChild(row);
            });
        }
        const saveButton = el("saveExpiredBatch");
        if (saveButton) {
            saveButton.disabled = !state.drafts.length;
            saveButton.textContent = state.drafts.length
                ? `Simpan (${state.drafts.length})`
                : "Simpan";
        }
    }


    async function saveEditedRecord() {
        const original = state.editingRecord;
        const button = el("expiredOkBtn");
        if (!original || !state.selectedProduct) return;

        const month = Number(el("expiredMonth").value);
        const year = Number(el("expiredYear").value);
        if (!month) {
            setLookupMessage("Pilih bulan expired terlebih dahulu.", true);
            return;
        }
        if (!Number.isInteger(year) || year < 2000 || year > 2100) {
            setLookupMessage("Tahun expired harus antara 2000 sampai 2100.", true);
            el("expiredYear").focus();
            return;
        }

        const barcode = normalizeCode(state.selectedProduct.kode || original.barcode);
        const updatedRecord = {
            ...original,
            barcode,
            nama: String(state.selectedProduct.nama || original.nama || ""),
            rak: state.selectedRack || original.rak || "",
            bulan: month,
            tahun: year,
            tahunBulan: `${year}-${String(month).padStart(2, "0")}`,
            eksekusi: el("expiredExecution").value || "- 1 Bulan",
            updatedAt: new Date().toISOString()
        };

        button.disabled = true;
        button.textContent = "Menyimpan...";

        try {
            if (!state.db) state.db = await openExpiredDatabase();

            await new Promise((resolve, reject) => {
                const tx = state.db.transaction(EXPIRED_STORE, "readwrite");
                const store = tx.objectStore(EXPIRED_STORE);
                const getAllRequest = store.getAll();
                const updatedKey = getRecordKey(updatedRecord);

                getAllRequest.onsuccess = () => {
                    (getAllRequest.result || []).forEach(existing => {
                        if (
                            existing.id !== original.id &&
                            getRecordKey(existing) === updatedKey
                        ) {
                            store.delete(existing.id);
                        }
                    });
                    store.put(updatedRecord);
                };

                getAllRequest.onerror = () => tx.abort();
                tx.oncomplete = resolve;
                tx.onerror = () => reject(
                    tx.error || new Error("Data expired gagal diperbarui.")
                );
                tx.onabort = () => reject(
                    tx.error || new Error("Perubahan data dibatalkan.")
                );
            });

            await loadRecords();
            closeModal();
            showSuccess("Berhasil! Data expired telah diperbarui.");
        } catch (error) {
            setLookupMessage(
                "Data gagal diperbarui: " +
                (error.message || "kesalahan database."),
                true
            );
            button.disabled = false;
            button.textContent = "Simpan";
        }
    }


    async function saveBatch() {
        if (!state.drafts.length) return;

        const saveButton = el("saveExpiredBatch");
        saveButton.disabled = true;
        saveButton.textContent = "Menyimpan...";

        try {
            if (!state.db) {
                state.db = await openExpiredDatabase();
            }

            const draftsToSave = [...state.drafts];

            await new Promise((resolve, reject) => {
                const tx = state.db.transaction(
                    EXPIRED_STORE,
                    "readwrite"
                );

                const store = tx.objectStore(EXPIRED_STORE);
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = () => {
                    const existingRecords = getAllRequest.result || [];

                    const latestByKey = new Map();

                    // Pastikan setiap kombinasi barcode dan tanggal
                    // expired hanya disimpan satu kali dalam batch.
                    draftsToSave.forEach(draft => {
                        const key = getRecordKey(draft);

                        if (key) {
                            latestByKey.set(key, draft);
                        }
                    });

                    // Hapus data lama yang memiliki barcode dan
                    // tanggal expired sama dengan input terbaru.
                    existingRecords.forEach(record => {
                        const key = getRecordKey(record);

                        if (key && latestByKey.has(key)) {
                            store.delete(record.id);
                        }
                    });

                    // Simpan input terbaru sebagai pengganti data lama.
                    latestByKey.forEach(draft => {
                        store.add({
                            barcode: draft.barcode,
                            nama: draft.nama,
                            rak: draft.rak,
                            bulan: draft.bulan,
                            tahun: draft.tahun,
                            tahunBulan: `${draft.tahun}-${
                                String(draft.bulan).padStart(2, "0")
                            }`,
                            eksekusi: draft.eksekusi || "- 1 Bulan",
                            createdAt: new Date().toISOString()
                        });
                    });
                };

                getAllRequest.onerror = () => {
                    tx.abort();
                };

                tx.oncomplete = resolve;

                tx.onerror = () => {
                    reject(
                        tx.error ||
                        new Error("Data gagal disimpan.")
                    );
                };

                tx.onabort = () => {
                    reject(
                        tx.error ||
                        new Error("Penyimpanan dibatalkan.")
                    );
                };
            });

            const savedCount = state.drafts.length;

            state.drafts = [];

            await loadRecords();
            closeModal();

            showSuccess(
                `Berhasil! ${savedCount.toLocaleString("id-ID")} ` +
                "data expired berhasil disimpan."
            );
        } catch (error) {
            setLookupMessage(
                "Gagal menyimpan data: " +
                (error.message || "kesalahan database."),
                true
            );

            saveButton.disabled = false;
            renderDrafts();
        }
    }

    async function deleteRecord(id) {
        const record = state.records.find(item => item.id === id);
        if (!record) return;
        if (
            !window.confirm(
                `Hapus data expired untuk ${record.nama || record.barcode}?`
            )
        ) return;

        try {
            if (!state.db) state.db = await openExpiredDatabase();
            await new Promise((resolve, reject) => {
                const tx = state.db.transaction(EXPIRED_STORE, "readwrite");
                tx.objectStore(EXPIRED_STORE).delete(id);
                tx.oncomplete = resolve;
                tx.onerror = () => reject(
                    tx.error || new Error("Data gagal dihapus.")
                );
                tx.onabort = () => reject(
                    tx.error || new Error("Penghapusan data dibatalkan.")
                );
            });
            await loadRecords();
            showSuccess("Berhasil! Data expired telah dihapus.");
        } catch (error) {
            showSuccess("Data gagal dihapus. Silakan coba lagi.", true);
        }
    }

    function bindStatusDeleteGesture(cell, record) {
        let holdTimer = null;
        let startX = 0;
        let startY = 0;

        const clearHoldTimer = () => {
            if (holdTimer !== null) {
                clearTimeout(holdTimer);
                holdTimer = null;
            }
        };

        cell.tabIndex = 0;
        cell.setAttribute("role", "button");
        cell.setAttribute(
            "aria-label",
            `Tekan dan tahan untuk menghapus data ${record.nama || record.barcode}`
        );
        cell.title = "Tekan dan tahan untuk menghapus data ini";

        cell.addEventListener("pointerdown", event => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            clearHoldTimer();
            startX = event.clientX;
            startY = event.clientY;
            holdTimer = window.setTimeout(() => {
                holdTimer = null;
                deleteRecord(record.id);
            }, 600);
        });

        cell.addEventListener("pointermove", event => {
            if (holdTimer === null) return;
            if (
                Math.abs(event.clientX - startX) > 12 ||
                Math.abs(event.clientY - startY) > 12
            ) {
                clearHoldTimer();
            }
        });

        ["pointerup", "pointercancel", "pointerleave"].forEach(eventName => {
            cell.addEventListener(eventName, clearHoldTimer);
        });
        cell.addEventListener("contextmenu", event => event.preventDefault());
        cell.addEventListener("keydown", event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            deleteRecord(record.id);
        });
    }

    let successTimer = null;
    function showSuccess(message, isError = false) {
        const popup = el("expiredSuccessPopup");
        if (!popup) return;
        el("expiredSuccessTitle").textContent = isError ? "Belum berhasil" : "Berhasil";
        el("expiredSuccessMessage").textContent = message;
        const icon = el("expiredSuccessIcon");
        icon.textContent = isError ? "!" : "✓";
        icon.classList.toggle("is-error", !!isError);
        popup.hidden = false;
        popup.setAttribute("aria-hidden", "false");
        if (successTimer) clearTimeout(successTimer);
        successTimer = setTimeout(() => {
            popup.hidden = true;
            popup.setAttribute("aria-hidden", "true");
        }, 2200);
    }

    function stopCameraScanner() {
        state.cameraActive = false;
        if (state.cameraFrame) cancelAnimationFrame(state.cameraFrame);
        state.cameraFrame = 0;
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(track => track.stop());
        }
        state.cameraStream = null;
        state.cameraDetector = null;
        const video = el("expiredCameraVideo");
        if (video) video.srcObject = null;
        const modal = el("expiredCameraModal");
        if (modal) {
            modal.hidden = true;
            modal.setAttribute("aria-hidden", "true");
        }
    }

    function handleScannedBarcode(rawCode) {
        const code = normalizeCode(rawCode);
        const input = el("expiredProductSearch");
        input.value = code;
        const product = state.codeIndex.get(normalizeText(code));
        if (product) {
            selectProduct(product);
            setLookupMessage(
                `Barcode ${code} ditemukan. Periksa bulan/tahun expired ` +
                "sebelum menambahkan."
            );
        } else {
            state.scanMode = false;
            el("scanExpiredBarcode").classList.remove("is-scanning");
            renderScanButton("Scan");
            setLookupMessage(`Barcode ${code} tidak ditemukan di Master Produk.`, true);
            input.focus();
        }
    }

    async function scanCameraFrame() {
        if (!state.cameraActive || !state.cameraDetector) return;
        const video = el("expiredCameraVideo");
        if (video && video.readyState >= 2) {
            try {
                const detected = await state.cameraDetector.detect(video);
                if (detected && detected.length && detected[0].rawValue) {
                    const code = detected[0].rawValue;
                    stopCameraScanner();
                    handleScannedBarcode(code);
                    return;
                }
            } catch (error) {
                const status = el("expiredCameraStatus");
                if (status) {
                    status.textContent =
                        "Barcode belum terbaca. Atur jarak atau pencahayaan, " +
                        "lalu arahkan barcode ke bingkai.";
                }
            }
        }
        if (state.cameraActive) {
            state.cameraFrame = requestAnimationFrame(scanCameraFrame);
        }
    }

    async function startCameraScanner() {
        if (
            !navigator.mediaDevices?.getUserMedia ||
            typeof window.BarcodeDetector === "undefined"
        ) {
            return false;
        }
        let formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
        if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
            const supported = await window.BarcodeDetector.getSupportedFormats();
            formats = formats.filter(format => supported.includes(format));
        }
        if (!formats.length) return false;

        state.cameraDetector = new window.BarcodeDetector({ formats });
        state.cameraStream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: "environment" } }
        });
        const video = el("expiredCameraVideo");
        video.srcObject = state.cameraStream;
        await video.play();
        state.cameraActive = true;
        el("expiredCameraModal").hidden = false;
        el("expiredCameraModal").setAttribute("aria-hidden", "false");
        el("expiredCameraStatus").textContent =
            "Arahkan barcode ke bingkai. Setelah terbaca, " +
            "data produk akan dicari otomatis.";
        state.cameraFrame = requestAnimationFrame(scanCameraFrame);
        return true;
    }

    function setupEvents() {
        el("addExpiredData")?.addEventListener("click", openModal);
        el("closeExpiredModal")?.addEventListener("click", closeModal);
        el("cancelExpiredModal")?.addEventListener("click", closeModal);
        el("expiredModal")?.addEventListener("click", event => {
            if (event.target === el("expiredModal")) closeModal();
        });
        el("expiredSearch")?.addEventListener("input", renderRecords);
        el("expiredProductSearch")?.addEventListener("input", () => {
            state.selectedProduct = null;
            el("expiredSelectedBarcode").value = "";
            el("expiredSelectedName").value = "";
            el("expiredSelectedRack").value = "";
            const resultCard = el("expiredLookupResult");
            if (resultCard) resultCard.hidden = true;
            renderAutocomplete();
        });
        el("expiredProductSearch")?.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            const query = el("expiredProductSearch").value.trim();
            const exact = state.codeIndex.get(normalizeText(normalizeCode(query)));
            const matches = findProducts(query);
            if (exact) {
                selectProduct(exact);
            } else if (state.scanMode) {
                setLookupMessage(
                    "Barcode tidak ditemukan di Master Produk. " +
                    "Periksa barcode atau unggah master produk terbaru.",
                    true
                );
                state.scanMode = false;
                el("scanExpiredBarcode").classList.remove("is-scanning");
                renderScanButton("Scan");
            } else if (matches.length === 1) {
                selectProduct(matches[0]);
            } else if (matches.length > 1) {
                selectProduct(matches[0]);
            }
        });
        el("expiredProductSearch")?.addEventListener("focus", () => {
            if (el("expiredProductSearch").value.trim()) renderAutocomplete();
        });
        el("scanExpiredBarcode")?.addEventListener("click", async () => {
            try {
                await loadLookupIndexes();
            } catch (_) {
                return;
            }

            clearSelectedProduct();
            state.scanMode = false;
            el("scanExpiredBarcode").classList.remove("is-scanning");
            renderScanButton("Scan");
            try {
                const cameraOpened = await startCameraScanner();
                if (cameraOpened) return;
            } catch (error) {
                stopCameraScanner();
                setLookupMessage(
                    "Kamera tidak dapat dibuka. Anda tetap bisa memakai " +
                    "scanner fisik atau mengetik barcode."
                );
            }
            state.scanMode = true;
            const button = el("scanExpiredBarcode");
            button.classList.add("is-scanning");
            renderScanButton("Siap Scan");
            const input = el("expiredProductSearch");
            input.value = "";
            input.placeholder = "Pindai barcode, lalu tekan Enter...";
            input.focus();
            setLookupMessage(
                "Mode scanner fisik aktif. Pindai barcode ke kolom ini, " +
                "lalu pastikan scanner mengirim tombol Enter."
            );
        });
        el("closeExpiredCamera")?.addEventListener("click", stopCameraScanner);
        el("stopExpiredCamera")?.addEventListener("click", stopCameraScanner);
        el("expiredCameraModal")?.addEventListener("click", event => {
            if (event.target === el("expiredCameraModal")) stopCameraScanner();
        });
        el("expiredProductSearch")?.addEventListener("blur", () => {
            setTimeout(() => {
                if (el("expiredAutocomplete")) {
                    el("expiredAutocomplete").hidden = true;
                }
            }, 160);
        });
        el("expiredOkBtn")?.addEventListener("click", () => {
            if (state.editingRecord) {
                saveEditedRecord();
                return;
            }
            addDraft();
        });
        el("saveExpiredBatch")?.addEventListener("click", saveBatch);
        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            if (
                el("expiredCameraModal") &&
                !el("expiredCameraModal").hidden
            ) {
                stopCameraScanner();
            } else if (el("expiredModal") && !el("expiredModal").hidden) {
                closeModal();
            }
        });
    }

    function setupHorizontalScrollIndicator() {
        const tableBody = el("expiredTableBody");
        const wrapper = tableBody?.closest(".expired-table-wrapper");

        if (
            !wrapper ||
            wrapper.dataset.scrollIndicatorReady === "true"
        ) {
            return;
        }

        const indicator = document.createElement("div");
        indicator.className = "expired-scroll-indicator";
        indicator.setAttribute("aria-hidden", "true");

        const thumb = document.createElement("span");
        thumb.className = "expired-scroll-indicator-thumb";
        indicator.appendChild(thumb);
        wrapper.insertAdjacentElement("afterend", indicator);
        wrapper.dataset.scrollIndicatorReady = "true";

        const updateIndicator = () => {
            const visibleWidth = wrapper.clientWidth;
            const contentWidth = wrapper.scrollWidth;

            if (!visibleWidth || !contentWidth) return;

            const visibleRatio = Math.min(1, visibleWidth / contentWidth);
            const thumbWidth = Math.min(100, Math.max(12, visibleRatio * 100));
            const maxScroll = Math.max(0, contentWidth - visibleWidth);
            const maxThumbTravel = 100 - thumbWidth;
            const thumbPosition = maxScroll > 0
                ? (wrapper.scrollLeft / maxScroll) * maxThumbTravel
                : 0;

            thumb.style.width = `${thumbWidth}%`;
            thumb.style.left = `${thumbPosition}%`;
        };

        wrapper.addEventListener("scroll", updateIndicator, { passive: true });
        window.addEventListener("resize", updateIndicator, { passive: true });

        if (typeof ResizeObserver === "function") {
            const observer = new ResizeObserver(updateIndicator);
            observer.observe(wrapper);

            const table = wrapper.querySelector("table");
            if (table) observer.observe(table);
        }

        updateIndicator();
    }

    let initialized = false;
    let initPromise = null;

    async function initExpiredPage() {
        // The menu markup is inserted only when the user first opens Data Expired.
        if (!el("expiredTableBody")) return;
        if (initialized) return;
        if (initPromise) return initPromise;

        initPromise = (async () => {
            setupHorizontalScrollIndicator();
            setupEvents();
            try {
                state.db = await openExpiredDatabase();
                await loadRecords();
            } catch (error) {
                const body = el("expiredTableBody");
                if (body) {
                    body.innerHTML = "";
                    const row = document.createElement("tr");
                    const cell = document.createElement("td");
                    cell.colSpan = 7;
                    cell.className = "expired-empty-cell";
                    cell.textContent =
                "Data expired belum dapat dibaca. Silakan " +
                "refresh aplikasi.";
                    row.appendChild(cell);
                    body.appendChild(row);
                }
                console.error("Gagal menginisialisasi Data Expired:", error);
            } finally {
                initialized = true;
                initPromise = null;
            }
        })();

        return initPromise;
    }

    // Called by app.js after the Data Expired fragment is loaded.
    window.initExpiredPage = initExpiredPage;
})();
