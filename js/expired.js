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
    const LAST_EXPIRY_YEAR_KEY = "toolsToko.expired.lastUsedYear";

    const state = {
        db: null,
        records: [],
        products: [],
        codeIndex: new Map(),
        firstCharIndex: new Map(),
        stockIndex: new Map(),
        executionProducts: [],
        executionCodeIndex: new Map(),
        executionFirstCharIndex: new Map(),
        executionSelectedProduct: null,
        executionDrafts: [],
        scanTarget: "add",
        lookupLoaded: false,
        lookupLoading: null,
        selectedProduct: null,
        selectedRack: "",
        editingRecord: null,
        drafts: [],
        activeDetailKey: null,
        scanMode: false,
        html5QrCode: null,
        cameraActive: false,
        cameraTorch: false,
        lastUsedYear: new Date().getFullYear()
    };

    const el = id => document.getElementById(id);

    function updateSearchClearButton(input) {
        if (!input) return;

        const clearButton = input.parentElement?.querySelector(
            ".expired-search-clear"
        );
        if (clearButton) {
            clearButton.hidden = !input.value.trim();
        }
    }

    function setupSearchClearButton(inputId) {
        const input = el(inputId);
        const clearButton = input?.parentElement?.querySelector(
            ".expired-search-clear"
        );
        if (!input || !clearButton) return;

        input.addEventListener("input", () => {
            updateSearchClearButton(input);
        });
        clearButton.addEventListener("click", () => {
            input.value = "";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.focus();
        });
        updateSearchClearButton(input);
    }

    function renderScanButton(label = "Scan", target = "add") {
        const button = el(
            target === "execution"
                ? "scanExpiredExecutionBarcode"
                : "scanExpiredBarcode"
        );
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
        button.setAttribute(
            "aria-label",
            label === "Scan" ? "Scan barcode" : label
        );
    }

    function normalizeCode(value) {
        return String(value ?? "").trim().replace(/\s+/g, "");
    }

    function normalizeText(value) {
        return String(value ?? "").toLocaleLowerCase("id-ID").trim();
    }

    function getLastUsedYear() {
        try {
            const storedYear = Number(
                window.localStorage.getItem(LAST_EXPIRY_YEAR_KEY)
            );
            if (
                Number.isInteger(storedYear) &&
                storedYear >= 2000 &&
                storedYear <= 2100
            ) {
                state.lastUsedYear = storedYear;
            }
        } catch (_) {
            // Gunakan nilai sesi bila penyimpanan lokal tidak tersedia.
        }

        return state.lastUsedYear;
    }

    function rememberExpiryYear(value) {
        const year = Number(value);
        if (!Number.isInteger(year) || year < 2000 || year > 2100) return;

        state.lastUsedYear = year;
        try {
            window.localStorage.setItem(LAST_EXPIRY_YEAR_KEY, String(year));
        } catch (_) {
            // Nilai tetap dipertahankan selama halaman aktif.
        }
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
        updateSearchClearButton(el("expiredProductSearch"));
        el("expiredProductSearch").placeholder = "Search....";
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
        updateSearchClearButton(el("expiredProductSearch"));
        el("expiredProductSearch").placeholder = "Search....";
        el("expiredMonth").value = "";
        el("expiredDay").value = "";
        el("expiredAutocomplete").hidden = true;
    }

    function setDateEntryMode(enabled) {
        const toggle = el("expiredDateToggle");
        const dayField = el("expiredDayField");
        const dateRow = el("expiredDateRow");
        if (!toggle || !dayField || !dateRow) return;

        toggle.checked = Boolean(enabled);
        dayField.hidden = !toggle.checked;
        dateRow.classList.toggle("has-day", toggle.checked);

        if (!toggle.checked) {
            el("expiredDay").value = "";
        }
    }

    function readOptionalExpiryDay(month, year) {
        if (!el("expiredDateToggle").checked) {
            return { day: null, error: "" };
        }

        const rawDay = el("expiredDay").value.trim();
        if (!rawDay) {
            return {
                day: null,
                error: "Isi tanggal expired terlebih dahulu."
            };
        }

        const day = Number(rawDay);
        const maxDay = new Date(year, month, 0).getDate();
        if (!Number.isInteger(day) || day < 1 || day > maxDay) {
            return {
                day: null,
                error: `Tanggal untuk bulan ini harus antara 1 sampai ${maxDay}.`
            };
        }

        return { day, error: "" };
    }

    function prepareAdditionalExpiry(draft) {
        state.editingRecord = null;
        el("expiredModal").classList.remove("is-editing");

        selectProduct(
            {
                kode: draft.barcode,
                nama: draft.nama
            },
            draft.rak || ""
        );

        el("expiredMonth").value = "";
        el("expiredYear").value = String(getLastUsedYear());
        el("expiredDay").value = "";
        el("expiredExecution").value = draft.eksekusi || "- 1 Bulan";

        setLookupMessage(
            "Produk dipilih ulang. Masukkan tanggal expired berikutnya."
        );
        el("expiredMonth").focus();
    }

    function formatMonthYear(month, year) {
        const monthIndex = Number(month) - 1;
        if (monthIndex < 0 || monthIndex > 11 || !year) return "—";
        return `${MONTHS[monthIndex]} ${year}`;
    }

    function formatExpiryDate(record) {
        const month = Number(record.bulan);
        const year = Number(record.tahun);
        const monthYear = formatMonthYear(month, year);
        const rawDay = record.tanggal;

        if (
            rawDay === null || rawDay === undefined || rawDay === "" ||
            !Number.isInteger(Number(rawDay))
        ) {
            return monthYear;
        }

        const day = Number(rawDay);
        if (day < 1 || day > new Date(year, month, 0).getDate()) {
            return monthYear;
        }

        return `${String(day).padStart(2, "0")} ${MONTHS[month - 1]} ${year}`;
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


    function formatMonthDuration(months) {
        const years = Math.floor(months / 12);
        const remainingMonths = months % 12;

        if (years === 0) {
            return `${months} Bulan`;
        }

        if (remainingMonths === 0) {
            return `${years} Tahun`;
        }

        return `${years} th ${remainingMonths} bulan`;
    }

    function getKeterangan(record, now = new Date()) {
        if (record.executionPending === true) {
            return "Menunggu Update";
        }

        const monthsUntilExpiry = getMonthsUntilExpiry(record, now);

        if (monthsUntilExpiry === null) {
            return "—";
        }

        if (monthsUntilExpiry > 0) {
            return `- ${formatMonthDuration(monthsUntilExpiry)}`;
        }

        if (monthsUntilExpiry < 0) {
            return `+ ${formatMonthDuration(Math.abs(monthsUntilExpiry))}`;
        }

        return "Bulan Ini";
    }

  

    function getExecutionLeadMonths(record) {
        const execution = String(record.eksekusi || "- 1 Bulan");
        const match = execution.match(/(?:H\s*)?-\s*(\d+)\s*bulan/i);
        const months = match ? Number(match[1]) : 1;

        return Number.isInteger(months) && months > 0 ? months : 1;
    }

    function getExactExpiryDate(record) {
        const month = Number(record.bulan);
        const year = Number(record.tahun);
        const rawDay = record.tanggal;

        if (
            rawDay === null || rawDay === undefined || rawDay === "" ||
            !Number.isInteger(month) || month < 1 || month > 12 ||
            !Number.isInteger(year) || year < 2000 || year > 2100
        ) {
            return null;
        }

        const day = Number(rawDay);
        const lastDay = new Date(year, month, 0).getDate();
        if (!Number.isInteger(day) || day < 1 || day > lastDay) {
            return null;
        }

        return new Date(year, month - 1, day);
    }

    function subtractCalendarMonths(date, months) {
        const totalMonths =
            date.getFullYear() * 12 + date.getMonth() - months;
        const targetYear = Math.floor(totalMonths / 12);
        const targetMonth = totalMonths - targetYear * 12;
        const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
        const targetDay = Math.min(date.getDate(), lastDay);

        return new Date(targetYear, targetMonth, targetDay);
    }

    function getStatus(record, now = new Date()) {
        if (record.executionPending === true) {
            return {
                label: "Sudah Eksekusi",
                className: "expired-status-executed"
            };
        }

        const exactExpiryDate = getExactExpiryDate(record);

        if (exactExpiryDate) {
            const today = new Date(
                now.getFullYear(),
                now.getMonth(),
                now.getDate()
            );

            // Tanggal lengkap memakai batas eksekusi berdasarkan hari kalender.
            if (today >= exactExpiryDate) {
                return {
                    label: "Harus Eksekusi /\nUpdate Sekarang",
                    className: "expired-status-urgent"
                };
            }

            const executionDate = subtractCalendarMonths(
                exactExpiryDate,
                getExecutionLeadMonths(record)
            );

            if (today >= executionDate) {
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

        // Data tanpa tanggal lengkap tetap memakai perhitungan bulan/tahun lama.
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
        const rawDay = record.tanggal;
        const day = rawDay === null || rawDay === undefined || rawDay === ""
            ? 0
            : Number(rawDay);

        if (
            !barcode || !Number.isInteger(month) || month < 1 || month > 12 ||
            !Number.isInteger(year) || year < 2000 || year > 2100 ||
            !Number.isInteger(day) || day < 0 || day > new Date(year, month, 0).getDate()
        ) {
            return null;
        }

        return `${barcode}|${year}-${String(month).padStart(2, "0")}-${
            String(day).padStart(2, "0")
        }`;
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

    function compareExpiryRecords(first, second) {
        const firstValue =
            Number(first.tahun) * 10000 +
            Number(first.bulan) * 100 +
            (Number(first.tanggal) || 0);
        const secondValue =
            Number(second.tahun) * 10000 +
            Number(second.bulan) * 100 +
            (Number(second.tanggal) || 0);

        if (firstValue !== secondValue) return firstValue - secondValue;
        return Number(first.id || 0) - Number(second.id || 0);
    }

    function groupRecordsByProduct(records) {
        const groups = new Map();

        records.forEach((record, index) => {
            const barcode = normalizeCode(record.barcode);
            const key = barcode || `record-${record.id ?? index}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    barcode,
                    records: []
                });
            }
            groups.get(key).records.push(record);
        });

        return Array.from(groups.values())
            .map(group => ({
                ...group,
                records: group.records.sort(compareExpiryRecords),
                latestActivity: group.records.reduce((latest, record) => {
                    const timestamp = Date.parse(
                        record.updatedAt || record.createdAt || ""
                    );

                    if (Number.isFinite(timestamp)) {
                        return Math.max(latest, timestamp);
                    }

                    // Data lama tanpa timestamp tetap mengikuti urutan input IndexedDB.
                    return Math.max(latest, Number(record.id || 0));
                }, 0)
            }))
            .sort((first, second) => {
                if (first.latestActivity !== second.latestActivity) {
                    return second.latestActivity - first.latestActivity;
                }

                // Jika waktunya sama, data dengan ID terbaru ditampilkan lebih dulu.
                return Number(second.records[0]?.id || 0) -
                    Number(first.records[0]?.id || 0);
            });
    }

    function createStatusBadge(record, currentDate) {
        const badge = document.createElement("span");
        const status = getStatus(record, currentDate);
        badge.className = `expired-status-badge ${status.className}`;
        badge.textContent = status.label;
        return badge;
    }

    function createKeteranganCell(record, currentDate) {
        const cell = document.createElement("td");

        if (record.executionPending === true) {
            const badge = document.createElement("span");
            badge.className = "expired-status-badge expired-status-executed";
            badge.textContent = "Menunggu Update";
            cell.appendChild(badge);
        } else {
            cell.textContent = getKeterangan(record, currentDate);
        }

        return cell;
    }

    function closeDetailView() {
        state.activeDetailKey = null;
        renderRecords();
    }

    function createDetailView(group, currentDate) {
        const view = el("expiredDetailView");
        if (!view) return;

        view.innerHTML = "";
        const record = group.records[0];

        const modal = document.createElement("section");
        modal.className = "expired-detail-modal";
        modal.setAttribute("aria-labelledby", "expiredDetailTitle");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("role", "dialog");

        const header = document.createElement("header");
        header.className = "expired-modal-header";

        const heading = document.createElement("div");

        const title = document.createElement("h3");
        title.id = "expiredDetailTitle";
        title.textContent = "Rincian Data Expired";

        const subtitle = document.createElement("p");
        subtitle.textContent =
            `${group.records.length.toLocaleString("id-ID")} tanggal expired untuk barang ini`;
        heading.append(title, subtitle);

        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "expired-modal-close";
        closeButton.textContent = "×";
        closeButton.setAttribute("aria-label", "Tutup rincian data expired");
        closeButton.title = "Tutup rincian";
        closeButton.addEventListener("click", closeDetailView);

        header.append(heading, closeButton);
        modal.appendChild(header);

        const modalBody = document.createElement("div");
        modalBody.className = "expired-modal-body expired-detail-modal-body";

        const productCard = document.createElement("section");
        productCard.className = "expired-detail-product-card";
        [
            ["Nama Barang", record.nama || "-"],
            ["Barcode", record.barcode || "-"],
            ["Rak", record.rak || "-"]
        ].forEach(([label, value]) => {
            const item = document.createElement("div");
            item.className = "expired-detail-product-item";
            const caption = document.createElement("span");
            caption.textContent = label;
            const content = document.createElement("strong");
            content.textContent = value;
            item.append(caption, content);
            productCard.appendChild(item);
        });
        modalBody.appendChild(productCard);

        const section = document.createElement("section");
        section.className = "expired-detail-record-section";
        const sectionTitle = document.createElement("h4");
        sectionTitle.textContent = "Daftar Tanggal Expired";
        section.appendChild(sectionTitle);

        const tableWrapper = document.createElement("div");
        tableWrapper.className = "expired-detail-table-wrapper";
        const table = document.createElement("table");
        table.className = "expired-detail-table";

        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        ["Tanggal Expired", "Keterangan", "Status", "Action"].forEach(label => {
            const th = document.createElement("th");
            th.textContent = label;
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        const tbody = document.createElement("tbody");
        group.records.forEach(item => {
            const row = document.createElement("tr");

            const dateCell = document.createElement("td");
            dateCell.className = "expired-detail-date-cell";
            dateCell.textContent = formatExpiryDate(item);
            row.appendChild(dateCell);

            row.appendChild(createKeteranganCell(item, currentDate));

            const statusCell = document.createElement("td");
            statusCell.className = "expired-status-cell";
            statusCell.appendChild(createStatusBadge(item, currentDate));
            bindStatusDeleteGesture(statusCell, item);
            row.appendChild(statusCell);

            const actionCell = document.createElement("td");
            const editButton = document.createElement("button");
            editButton.type = "button";
            editButton.className = "expired-edit-button";
            editButton.textContent = item.executionPending === true
                ? "Update"
                : "Edit";

            if (item.executionPending === true) {
                editButton.classList.add("expired-edit-button-execution");
            }

            editButton.addEventListener("click", () => openEditModal(item));
            actionCell.appendChild(editButton);
            row.appendChild(actionCell);

            tbody.appendChild(row);
        });
        table.appendChild(tbody);
        tableWrapper.appendChild(table);
        section.appendChild(tableWrapper);
        modalBody.appendChild(section);

        modal.appendChild(modalBody);
        view.appendChild(modal);
    }

    function renderRecords() {
        const body = el("expiredTableBody");
        const listView = el("expiredListView");
        const detailView = el("expiredDetailView");
        if (!body || !listView || !detailView) return;

        const query = normalizeText(el("expiredSearch")?.value || "");
        const currentDate = new Date();
        const groups = groupRecordsByProduct(state.records);
        const activeGroup = groups.find(group => group.key === state.activeDetailKey);

        if (activeGroup) {
            listView.hidden = false;
            detailView.hidden = false;
            detailView.setAttribute("aria-hidden", "false");
            createDetailView(activeGroup, currentDate);
            return;
        }

        state.activeDetailKey = null;
        listView.hidden = false;
        detailView.hidden = true;
        detailView.setAttribute("aria-hidden", "true");

        const filteredGroups = groups.filter(group => {
            if (!query) return true;

            return group.records.some(record => {
                const status = getStatus(record, currentDate).label;
                return [
                    record.barcode,
                    record.nama,
                    record.rak,
                    formatExpiryDate(record),
                    getKeterangan(record, currentDate),
                    record.eksekusi || "- 1 Bulan",
                    status
                ].some(value => normalizeText(value).includes(query));
            });
        });

        body.innerHTML = "";
        if (!filteredGroups.length) {
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
            filteredGroups.forEach(group => {
                const mainRecord = group.records[0];
                const row = document.createElement("tr");

                addCell(row, mainRecord.barcode);
                addCell(row, mainRecord.nama);
                addCell(row, mainRecord.rak, true);

                const dateCell = document.createElement("td");
                const dateText = document.createElement("span");
                dateText.textContent = formatExpiryDate(mainRecord);
                dateCell.appendChild(dateText);

                if (group.records.length > 1) {
                    const moreButton = document.createElement("button");
                    moreButton.type = "button";
                    moreButton.className = "expired-more-link";
                    moreButton.textContent = " ... selengkapnya";
                    moreButton.addEventListener("click", () => {
                        state.activeDetailKey = group.key;
                        renderRecords();
                    });
                    dateCell.appendChild(moreButton);
                }
                row.appendChild(dateCell);

                row.appendChild(createKeteranganCell(mainRecord, currentDate));

                const statusCell = document.createElement("td");
                statusCell.className = "expired-status-cell";
                statusCell.appendChild(createStatusBadge(mainRecord, currentDate));
                bindStatusDeleteGesture(statusCell, mainRecord, group.records);
                row.appendChild(statusCell);

                const actionCell = document.createElement("td");
                const editButton = document.createElement("button");
                editButton.type = "button";
                editButton.className = "expired-edit-button";
                const actionLabel = mainRecord.executionPending === true
                    ? "Update"
                    : "Edit";

                if (mainRecord.executionPending === true) {
                    editButton.classList.add("expired-edit-button-execution");
                }
                editButton.textContent = actionLabel;
                editButton.setAttribute(
                    "aria-label",
                    `${actionLabel} tanggal expired ${mainRecord.nama || mainRecord.barcode}`
                );
                editButton.addEventListener("click", () => openEditModal(mainRecord));
                actionCell.appendChild(editButton);
                row.appendChild(actionCell);

                body.appendChild(row);

            });
        }

        const count = el("expiredRecordCount");
        if (count) {
            count.textContent = `${filteredGroups.length.toLocaleString("id-ID")} data`;
        }
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
        buildExecutionProductIndexes();
        renderRecords();
    }

    function buildExecutionProductIndexes() {
        const groups = groupRecordsByProduct(state.records);
        state.executionProducts = groups.map(group => {
            const firstRecord = group.records[0];
            return {
                kode: normalizeCode(firstRecord.barcode || group.barcode),
                nama: String(firstRecord.nama || ""),
                rak: String(firstRecord.rak || "")
            };
        });

        state.executionCodeIndex = new Map();
        state.executionFirstCharIndex = new Map();

        state.executionProducts.forEach(product => {
            const code = normalizeCode(product.kode);
            if (!code) return;

            state.executionCodeIndex.set(normalizeText(code), product);
            const keys = new Set([code[0].toLocaleLowerCase("id-ID")]);
            normalizeText(product.nama)
                .split(/[^\p{L}\p{N}]+/u)
                .filter(Boolean)
                .forEach(token => keys.add(token[0]));

            keys.forEach(key => {
                if (!state.executionFirstCharIndex.has(key)) {
                    state.executionFirstCharIndex.set(key, []);
                }
                state.executionFirstCharIndex.get(key).push(product);
            });
        });
    }

    function findExecutionProducts(query) {
        const q = normalizeText(query);
        if (!q) return [];

        const exact = state.executionCodeIndex.get(
            normalizeText(normalizeCode(query))
        );
        if (exact) return [exact];

        const bucket = state.executionFirstCharIndex.get(q[0]) || [];
        const matches = [];

        for (const product of bucket) {
            const code = normalizeText(product.kode);
            const name = normalizeText(product.nama);
            const tokenMatch = name
                .split(/[^\p{L}\p{N}]+/u)
                .some(token => token.startsWith(q));

            if (code.startsWith(q) || tokenMatch || name.startsWith(q)) {
                matches.push(product);
                if (matches.length >= MAX_SUGGESTIONS) break;
            }
        }

        return matches;
    }

    function renderExecutionAutocomplete() {
        const input = el("expiredExecutionSearch");
        const list = el("expiredExecutionAutocomplete");
        if (!input || !list) return;

        const query = input.value.trim();
        list.innerHTML = "";
        if (!query) {
            list.hidden = true;
            return;
        }

        const products = findExecutionProducts(query);
        if (!products.length) {
            const empty = document.createElement("div");
            empty.className = "expired-autocomplete-empty";
            empty.textContent = "Produk tidak ditemukan.";
            list.appendChild(empty);
            list.hidden = false;
            return;
        }

        products.forEach(product => {
            const option = document.createElement("button");
            option.type = "button";
            option.className = "expired-autocomplete-option";

            const barcode = document.createElement("strong");
            barcode.textContent = product.kode;
            const name = document.createElement("span");
            name.textContent = product.nama || "Nama barang tidak tersedia";
            option.append(barcode, document.createTextNode(" : "), name);
            option.addEventListener("pointerdown", event => event.preventDefault());
            option.addEventListener("click", () => selectExecutionProduct(product));
            list.appendChild(option);
        });

        list.hidden = false;
    }

    function selectExecutionProduct(product) {
        state.executionSelectedProduct = product;
        el("expiredExecutionSearch").value = `${product.kode} : ${product.nama}`;
        updateSearchClearButton(el("expiredExecutionSearch"));
        el("expiredExecutionAutocomplete").hidden = true;

        el("expiredExecutionResultBarcode").textContent = product.kode;
        el("expiredExecutionResultRack").textContent = product.rak || "";
        el("expiredExecutionResultName").textContent =
            product.nama || "Nama barang tidak tersedia";
        el("expiredExecutionLookupResult").hidden = false;

        state.scanMode = false;
        state.scanTarget = "execution";
        el("scanExpiredExecutionBarcode").classList.remove("is-scanning");
        renderScanButton("Scan", "execution");
    }

    function clearExecutionSelectedProduct(clearInput = true) {
        state.executionSelectedProduct = null;
        const input = el("expiredExecutionSearch");
        if (input) {
            if (clearInput) input.value = "";
            updateSearchClearButton(input);
            input.placeholder = "Search....";
        }
        if (el("expiredExecutionAutocomplete")) {
            el("expiredExecutionAutocomplete").hidden = true;
        }
        if (el("expiredExecutionLookupResult")) {
            el("expiredExecutionLookupResult").hidden = true;
        }
    }

    function addExecutionDraft() {
        const product = state.executionSelectedProduct;
        if (!product) {
            renderExecutionAutocomplete();
            el("expiredExecutionSearch").focus();
            return;
        }

        const barcode = normalizeCode(product.kode);
        const duplicate = state.executionDrafts.some(
            draft => normalizeCode(draft.kode) === barcode
        );
        if (duplicate) {
            clearExecutionSelectedProduct();
            el("expiredExecutionSearch").focus();
            return;
        }

        state.executionDrafts.push({ ...product });
        renderExecutionDrafts();
        clearExecutionSelectedProduct();
        el("expiredExecutionSearch").focus();
    }

    function renderExecutionDrafts() {
        const list = el("expiredExecutionDraftList");
        if (!list) return;
        list.innerHTML = "";

        if (!state.executionDrafts.length) {
            const empty = document.createElement("p");
            empty.className = "expired-execution-empty";
            empty.textContent = "Belum ada produk di daftar input.";
            list.appendChild(empty);
            return;
        }

        state.executionDrafts.forEach((product, index) => {
            const card = document.createElement("article");
            card.className = "expired-execution-draft-card";

            const top = document.createElement("div");
            top.className = "expired-lookup-result-top";
            const barcode = document.createElement("strong");
            barcode.textContent = product.kode;
            const rack = document.createElement("span");
            rack.textContent = product.rak || "";

            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "expired-execution-draft-remove";
            remove.setAttribute(
                "aria-label",
                `Hapus ${product.nama || product.kode} dari daftar input`
            );
            remove.title = "Hapus dari daftar input";
            remove.innerHTML =
                '<svg viewBox="0 0 24 24" aria-hidden="true" ' +
                'focusable="false">' +
                '<path d="M3 6h18M8 6V4h8v2" />' +
                '<path d="M19 6l-1 14H6L5 6" />' +
                '<path d="M10 11v5M14 11v5" />' +
                '</svg>';
            remove.addEventListener("click", () => {
                state.executionDrafts.splice(index, 1);
                renderExecutionDrafts();
            });

            top.append(barcode, rack, remove);

            const name = document.createElement("div");
            name.className = "expired-lookup-result-name";
            name.textContent = product.nama || "Nama barang tidak tersedia";

            card.append(top, name);
            list.appendChild(card);
        });
    }

    function openExecutionModal() {
        stopCameraScanner();
        state.executionDrafts = [];
        state.scanTarget = "execution";
        state.scanMode = false;
        clearExecutionSelectedProduct();
        renderExecutionDrafts();

        const modal = el("expiredExecutionModal");
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        el("expiredExecutionSearch").focus();
    }

    function closeExecutionModal() {
        stopCameraScanner();
        const modal = el("expiredExecutionModal");
        if (modal) {
            modal.hidden = true;
            modal.setAttribute("aria-hidden", "true");
        }
        state.executionDrafts = [];
        state.scanMode = false;
        state.scanTarget = "add";
        clearExecutionSelectedProduct();
        renderExecutionDrafts();
    }

async function confirmExecution() {
        if (!state.executionDrafts.length) {
            showSuccess("Pilih minimal satu produk untuk dieksekusi.", true);
            return;
        }

        const button = el("confirmExpiredExecution");
        if (!button || button.disabled) return;

        const selectedBarcodes = new Set(
            state.executionDrafts
                .map(product => normalizeCode(product.kode))
                .filter(Boolean)
        );
        if (!selectedBarcodes.size) return;

        button.disabled = true;
        button.textContent = "Memproses...";

        try {
            if (!state.db) state.db = await openExpiredDatabase();

            const markedAt = new Date().toISOString();
            let matchedProducts = 0;

            await new Promise((resolve, reject) => {
                const tx = state.db.transaction(EXPIRED_STORE, "readwrite");
                const store = tx.objectStore(EXPIRED_STORE);
                const request = store.getAll();

                request.onsuccess = () => {
                    const matched = new Set();
                    (request.result || []).forEach(record => {
                        const barcode = normalizeCode(record.barcode);
                        if (!selectedBarcodes.has(barcode)) return;

                        store.put({
                            ...record,
                            executionPending: true,
                            executionMarkedAt: markedAt
                        });
                        matched.add(barcode);
                    });
                    matchedProducts = matched.size;
                };

                request.onerror = () => tx.abort();
                tx.oncomplete = resolve;
                tx.onerror = () => reject(
                    tx.error || new Error("Status eksekusi gagal disimpan.")
                );
                tx.onabort = () => reject(
                    tx.error || new Error("Proses eksekusi dibatalkan.")
                );
            });

            if (!matchedProducts) {
                showSuccess(
                    "Produk yang dipilih sudah tidak ditemukan di Data Expired. " +
                    "Muat ulang daftar lalu coba lagi.",
                    true
                );
                return;
            }

            await loadRecords();
            closeExecutionModal();

            const partialResult = matchedProducts < selectedBarcodes.size;
            showSuccess(
                partialResult
                    ? `${matchedProducts} dari ${selectedBarcodes.size} produk berhasil dieksekusi.`
                    : `Berhasil! ${matchedProducts.toLocaleString("id-ID")} produk sudah dieksekusi.`,
                partialResult
            );
        } catch (error) {
            showSuccess(
                "Eksekusi gagal disimpan: " +
                (error.message || "kesalahan database."),
                true
            );
        } finally {
            button.disabled = false;
            button.textContent = "Eksekusi";
        }
    }

    function openModal() {
        const modal = el("expiredModal");
        state.scanTarget = "add";
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
        el("expiredMonth").value = "";
        el("expiredYear").value = String(getLastUsedYear());
        el("expiredExecution").value = "- 1 Bulan";
        setDateEntryMode(false);

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
        state.scanTarget = "add";
        state.drafts = [];
        state.editingRecord = record;

        const modal = el("expiredModal");
        modal.classList.add("is-editing");
        const isExecutionUpdate = record.executionPending === true;
        el("expiredModalTitle").textContent = isExecutionUpdate
            ? "Update Data Expired"
            : "Edit Data Expired";
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
        setDateEntryMode(
            record.tanggal !== null &&
            record.tanggal !== undefined &&
            record.tanggal !== ""
        );
        el("expiredDay").value = record.tanggal ? String(record.tanggal) : "";

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
        state.scanTarget = "add";
        setDateEntryMode(false);
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

        const dateEntry = readOptionalExpiryDay(month, year);
        if (dateEntry.error) {
            setLookupMessage(dateEntry.error, true);
            el("expiredDay").focus();
            return;
        }

        rememberExpiryYear(year);

        const barcode = normalizeCode(product.kode);
        const stock = state.stockIndex.get(barcode);
        const execution = el("expiredExecution").value || "- 1 Bulan";
        const draftRecord = {
            barcode,
            bulan: month,
            tahun: year,
            tanggal: dateEntry.day
        };
        const key = getRecordKey(draftRecord);
        const duplicateInDrafts = state.drafts.some(
            draft => getRecordKey(draft) === key
        );
        const duplicateInSaved = state.records.some(
            record => getRecordKey(record) === key
        );

        if (duplicateInDrafts || duplicateInSaved) {
            setLookupMessage(
                "Tanggal expired tersebut sudah terdaftar untuk produk ini. Data ganda tidak ditambahkan.",
                true
            );
            return;
        }

        state.drafts.push({
            draftId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            barcode,
            nama: String(product.nama || ""),
            rak: state.selectedRack || stock?.rak || "",
            bulan: month,
            tahun: year,
            tanggal: dateEntry.day,
            eksekusi: execution
        });

        renderDrafts();
        clearSelectedProduct();
        el("expiredDay").value = "";
        setLookupMessage(
            `Tanggal expired ditambahkan ke daftar input (${state.drafts.length}).`
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
                addCell(row, formatExpiryDate(draft));

                const actionCell = document.createElement("td");
                const actions = document.createElement("div");
                actions.className = "expired-draft-actions";

                const addDateButton = document.createElement("button");
                addDateButton.type = "button";
                addDateButton.className = "expired-add-date-button";
                addDateButton.textContent = "+";
                addDateButton.setAttribute(
                    "aria-label",
                    `Tambah tanggal expired lain untuk ${draft.nama || draft.barcode}`
                );
                addDateButton.title = "Tambah tanggal expired lain untuk produk ini";
                addDateButton.addEventListener("click", () => {
                    prepareAdditionalExpiry(draft);
                });

                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.className = "expired-delete-button";
                removeButton.textContent = "×";
                removeButton.setAttribute(
                    "aria-label",
                    `Hapus ${draft.nama || draft.barcode} dari daftar input`
                );
                removeButton.title = "Hapus dari daftar input";
                removeButton.addEventListener("click", () => {
                    state.drafts = state.drafts.filter(
                        item => item.draftId !== draft.draftId
                    );
                    renderDrafts();
                });

                actions.append(addDateButton, removeButton);
                actionCell.appendChild(actions);
                row.appendChild(actionCell);
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

        const dateEntry = readOptionalExpiryDay(month, year);
        if (dateEntry.error) {
            setLookupMessage(dateEntry.error, true);
            el("expiredDay").focus();
            return;
        }

        const barcode = normalizeCode(state.selectedProduct.kode || original.barcode);
        rememberExpiryYear(year);

        const {
            executionPending: wasExecutionPending,
            ...originalRecord
        } = original;
        delete originalRecord.executionMarkedAt;

        const updatedRecord = {
            ...originalRecord,
            barcode,
            nama: String(state.selectedProduct.nama || original.nama || ""),
            rak: state.selectedRack || original.rak || "",
            bulan: month,
            tahun: year,
            tanggal: dateEntry.day,
            tahunBulan: `${year}-${String(month).padStart(2, "0")}`,
            eksekusi: el("expiredExecution").value || "- 1 Bulan",
            updatedAt: new Date().toISOString()
        };

        button.disabled = true;
        button.textContent = "Menyimpan...";

        try {
            if (!state.db) state.db = await openExpiredDatabase();

            let duplicateExists = false;
            await new Promise((resolve, reject) => {
                const tx = state.db.transaction(EXPIRED_STORE, "readwrite");
                const store = tx.objectStore(EXPIRED_STORE);
                const getAllRequest = store.getAll();
                const updatedKey = getRecordKey(updatedRecord);

                getAllRequest.onsuccess = () => {
                    const existingRecords = getAllRequest.result || [];
                    duplicateExists = existingRecords.some(existing =>
                        existing.id !== original.id &&
                        getRecordKey(existing) === updatedKey
                    );

                    if (!duplicateExists) {
                        store.put(updatedRecord);

                        if (wasExecutionPending === true) {
                            existingRecords.forEach(existing => {
                                if (
                                    existing.id !== original.id &&
                                    normalizeCode(existing.barcode) === barcode &&
                                    existing.executionPending === true
                                ) {
                                    const {
                                        executionPending,
                                        executionMarkedAt,
                                        ...clearedRecord
                                    } = existing;
                                    store.put(clearedRecord);
                                }
                            });
                        }
                    }
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

            if (duplicateExists) {
                setLookupMessage(
                    "Tanggal expired tersebut sudah terdaftar untuk produk ini. Data lama tetap dipertahankan.",
                    true
                );
                button.disabled = false;
                button.textContent = "Simpan";
                return;
            }

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
            let savedCount = 0;

            await new Promise((resolve, reject) => {
                const tx = state.db.transaction(EXPIRED_STORE, "readwrite");
                const store = tx.objectStore(EXPIRED_STORE);
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = () => {
                    const existingRecords = getAllRequest.result || [];
                    const existingKeys = new Set(
                        existingRecords
                            .map(getRecordKey)
                            .filter(Boolean)
                    );
                    const latestByKey = new Map();

                    draftsToSave.forEach(draft => {
                        const key = getRecordKey(draft);
                        if (key && !latestByKey.has(key)) {
                            latestByKey.set(key, draft);
                        }
                    });

                    latestByKey.forEach((draft, key) => {
                        if (existingKeys.has(key)) return;

                        store.add({
                            barcode: draft.barcode,
                            nama: draft.nama,
                            rak: draft.rak,
                            bulan: draft.bulan,
                            tahun: draft.tahun,
                            tanggal: draft.tanggal ?? null,
                            tahunBulan: `${draft.tahun}-${
                                String(draft.bulan).padStart(2, "0")
                            }`,
                            eksekusi: draft.eksekusi || "- 1 Bulan",
                            createdAt: new Date().toISOString()
                        });

                        existingKeys.add(key);
                        savedCount += 1;
                    });
                };

                getAllRequest.onerror = () => tx.abort();
                tx.oncomplete = resolve;
                tx.onerror = () => reject(
                    tx.error || new Error("Data gagal disimpan.")
                );
                tx.onabort = () => reject(
                    tx.error || new Error("Penyimpanan dibatalkan.")
                );
            });

            state.drafts = [];
            await loadRecords();
            closeModal();

            if (savedCount > 0) {
                showSuccess(
                    `Berhasil! ${savedCount.toLocaleString("id-ID")} ` +
                    "tanggal expired berhasil disimpan."
                );
            } else {
                showSuccess(
                    "Tidak ada data baru. Semua tanggal tersebut sudah terdaftar.",
                    true
                );
            }
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

    async function deleteRecord(id, recordsToDelete = null) {
        const selectedRecords = Array.isArray(recordsToDelete)
            ? recordsToDelete
            : [state.records.find(item => item.id === id)];
        const records = selectedRecords.filter(Boolean);
        const record = records.find(item => item.id === id) || records[0];
        const ids = [...new Set(records.map(item => item.id).filter(
            value => value !== undefined && value !== null
        ))];

        if (!record || !ids.length) return;

        const isGroupDeletion = ids.length > 1;
        const productName = record.nama || record.barcode || "barang ini";
        const confirmationMessage = isGroupDeletion
            ? `Hapus seluruh ${ids.length.toLocaleString("id-ID")} tanggal expired untuk ${productName}?`
            : `Hapus data expired untuk ${productName}?`;

        if (!window.confirm(confirmationMessage)) return;

        try {
            if (!state.db) state.db = await openExpiredDatabase();
            await new Promise((resolve, reject) => {
                const tx = state.db.transaction(EXPIRED_STORE, "readwrite");
                const store = tx.objectStore(EXPIRED_STORE);
                ids.forEach(recordId => store.delete(recordId));
                tx.oncomplete = resolve;
                tx.onerror = () => reject(
                    tx.error || new Error("Data gagal dihapus.")
                );
                tx.onabort = () => reject(
                    tx.error || new Error("Penghapusan data dibatalkan.")
                );
            });
            await loadRecords();
            showSuccess(
                isGroupDeletion
                    ? `Berhasil! ${ids.length.toLocaleString("id-ID")} tanggal expired untuk barang telah dihapus.`
                    : "Berhasil! Data expired telah dihapus."
            );
        } catch (error) {
            showSuccess("Data gagal dihapus. Silakan coba lagi.", true);
        }
    }

    function bindStatusDeleteGesture(cell, record, recordsToDelete = [record]) {
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
        const isGroupDeletion = recordsToDelete.length > 1;
        cell.setAttribute(
            "aria-label",
            isGroupDeletion
                ? `Tekan dan tahan untuk menghapus semua tanggal expired ${record.nama || record.barcode}`
                : `Tekan dan tahan untuk menghapus data ${record.nama || record.barcode}`
        );
        cell.title = isGroupDeletion
            ? "Tekan dan tahan untuk menghapus seluruh tanggal expired barang ini"
            : "Tekan dan tahan untuk menghapus data ini";

        cell.addEventListener("pointerdown", event => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            clearHoldTimer();
            startX = event.clientX;
            startY = event.clientY;
            holdTimer = window.setTimeout(() => {
                holdTimer = null;
                deleteRecord(record.id, recordsToDelete);
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
            deleteRecord(record.id, recordsToDelete);
        });
    }

    let successTimer = null;

    function hideSuccess() {
        const popup = el("expiredSuccessPopup");
        if (!popup) return;

        popup.hidden = true;
        popup.setAttribute("aria-hidden", "true");

        if (successTimer !== null) {
            clearTimeout(successTimer);
            successTimer = null;
        }
    }

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

        if (successTimer !== null) clearTimeout(successTimer);
        successTimer = window.setTimeout(hideSuccess, 2200);
    }

    function stopCameraScanner() {
        state.cameraActive = false;
        state.cameraTorch = false;

        const scanner = state.html5QrCode;
        state.html5QrCode = null;

        const torchButton = el("expiredCameraTorch");
        if (torchButton) {
            torchButton.classList.remove("is-active");
            torchButton.textContent = "⚡";
        }

        const reader = el("expiredCameraReader");
        if (scanner) {
            Promise.resolve()
                .then(() => scanner.stop())
                .catch(() => {})
                .finally(() => {
                    try {
                        scanner.clear();
                    } catch (_) {
                        // Scanner bisa gagal memulai kamera; bersihkan tetap aman.
                    }
                    if (reader) reader.innerHTML = "";
                });
        } else if (reader) {
            reader.innerHTML = "";
        }

        const modal = el("expiredCameraModal");
        if (modal) {
            modal.hidden = true;
            modal.setAttribute("aria-hidden", "true");
        }
    }

    function handleScannedBarcode(rawCode) {
        const code = normalizeCode(rawCode);

        if (state.scanTarget === "execution") {
            const input = el("expiredExecutionSearch");
            input.value = code;
            const product = state.executionCodeIndex.get(normalizeText(code));
            state.scanMode = false;
            el("scanExpiredExecutionBarcode").classList.remove("is-scanning");
            renderScanButton("Scan", "execution");

            if (product) {
                selectExecutionProduct(product);
            } else {
                clearExecutionSelectedProduct();
                input.value = code;
                const list = el("expiredExecutionAutocomplete");
                list.innerHTML = "";
                const empty = document.createElement("div");
                empty.className = "expired-autocomplete-empty";
                empty.textContent = "Produk tidak ditemukan.";
                list.appendChild(empty);
                list.hidden = false;
                input.focus();
            }
            return;
        }

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

    async function startCameraScanner() {
        if (typeof window.Html5Qrcode !== "function") {
            return false;
        }

        const reader = el("expiredCameraReader");
        const modal = el("expiredCameraModal");
        const status = el("expiredCameraStatus");
        if (!reader || !modal) return false;

        reader.innerHTML = "";
        const supportedFormats = window.Html5QrcodeSupportedFormats || {};
        const formats = [
            "EAN_13",
            "EAN_8",
            "UPC_A",
            "UPC_E",
            "CODE_128",
            "CODE_39",
            "ITF"
        ]
            .map(name => supportedFormats[name])
            .filter(format => format !== undefined);

        const scanner = new window.Html5Qrcode(
            "expiredCameraReader",
            formats.length ? { formatsToSupport: formats } : {}
        );

        state.html5QrCode = scanner;
        state.cameraActive = true;
        state.cameraTorch = false;
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");

        if (status) {
            status.textContent =
                "Arahkan barcode ke kamera belakang perangkat.";
        }

        try {
            await scanner.start(
                { facingMode: "environment" },
                {
                    fps: 10,
                    qrbox: 250
                },
                decodedText => {
                    if (!state.cameraActive) return;

                    stopCameraScanner();
                    handleScannedBarcode(decodedText);
                },
                () => {}
            );

            return true;
        } catch (error) {
            state.cameraActive = false;
            state.html5QrCode = null;
            modal.hidden = true;
            modal.setAttribute("aria-hidden", "true");
            reader.innerHTML = "";

            try {
                await scanner.clear();
            } catch (_) {
                // Tidak ada elemen scanner yang perlu dibersihkan.
            }

            throw error;
        }
    }

    function setupEvents() {
        setupSearchClearButton("expiredProductSearch");
        setupSearchClearButton("expiredExecutionSearch");

        el("expiredSuccessPopup")?.addEventListener("click", hideSuccess);
        el("addExpiredData")?.addEventListener("click", openModal);
        el("openExpiredExecution")?.addEventListener("click", openExecutionModal);
        el("closeExpiredExecution")?.addEventListener("click", closeExecutionModal);
        el("cancelExpiredExecution")?.addEventListener("click", closeExecutionModal);
        el("expiredExecutionModal")?.addEventListener("click", event => {
            if (event.target === el("expiredExecutionModal")) {
                closeExecutionModal();
            }
        });
        el("addExpiredExecutionDraft")?.addEventListener(
            "click",
            addExecutionDraft
        );
        el("confirmExpiredExecution")?.addEventListener(
            "click",
            confirmExecution
        );
        el("expiredExecutionSearch")?.addEventListener("input", () => {
            clearExecutionSelectedProduct(false);
            renderExecutionAutocomplete();
        });
        el("expiredExecutionSearch")?.addEventListener("focus", () => {
            if (el("expiredExecutionSearch").value.trim()) {
                renderExecutionAutocomplete();
            }
        });
        el("expiredExecutionSearch")?.addEventListener("keydown", event => {
            if (event.key !== "Enter") return;
            event.preventDefault();

            const query = el("expiredExecutionSearch").value.trim();
            const exact = state.executionCodeIndex.get(
                normalizeText(normalizeCode(query))
            );

            if (exact) {
                selectExecutionProduct(exact);
            } else if (state.scanMode && state.scanTarget === "execution") {
                const list = el("expiredExecutionAutocomplete");
                list.innerHTML = "";
                const empty = document.createElement("div");
                empty.className = "expired-autocomplete-empty";
                empty.textContent = "Produk tidak ditemukan.";
                list.appendChild(empty);
                list.hidden = false;
                state.scanMode = false;
                el("scanExpiredExecutionBarcode").classList.remove("is-scanning");
                renderScanButton("Scan", "execution");
            } else {
                const matches = findExecutionProducts(query);
                if (matches.length === 1) {
                    selectExecutionProduct(matches[0]);
                } else {
                    renderExecutionAutocomplete();
                }
            }
        });
        el("expiredExecutionSearch")?.addEventListener("blur", () => {
            window.setTimeout(() => {
                if (el("expiredExecutionAutocomplete")) {
                    el("expiredExecutionAutocomplete").hidden = true;
                }
            }, 160);
        });
        el("scanExpiredExecutionBarcode")?.addEventListener(
            "click",
            async () => {
                state.scanTarget = "execution";
                state.scanMode = false;
                clearExecutionSelectedProduct();
                try {
                    const cameraOpened = await startCameraScanner();
                    if (cameraOpened) return;
                } catch (error) {
                    stopCameraScanner();
                }

                state.scanMode = true;
                const button = el("scanExpiredExecutionBarcode");
                button.classList.add("is-scanning");
                renderScanButton("Siap Scan", "execution");
                const input = el("expiredExecutionSearch");
                input.value = "";
                input.placeholder = "Search....";
                input.focus();
            }
        );
        el("closeExpiredModal")?.addEventListener("click", closeModal);
        el("cancelExpiredModal")?.addEventListener("click", closeModal);
        el("expiredModal")?.addEventListener("click", event => {
            if (event.target === el("expiredModal")) closeModal();
        });
        el("expiredDetailView")?.addEventListener("click", event => {
            if (event.target === el("expiredDetailView")) {
                closeDetailView();
            }
        });
        el("expiredSearch")?.addEventListener("input", renderRecords);
        el("expiredDateToggle")?.addEventListener("change", event => {
            setDateEntryMode(event.target.checked);
        });
        el("expiredYear")?.addEventListener("change", event => {
            rememberExpiryYear(event.target.value);
        });
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
            if (state.scanMode && state.scanTarget === "execution") {
                const executionProduct = state.executionCodeIndex.get(
                    normalizeText(normalizeCode(query))
                );
                state.scanMode = false;
                el("scanExpiredExecutionBarcode").classList.remove("is-scanning");
                renderScanButton("Scan", "execution");
                if (executionProduct) {
                    selectExecutionProduct(executionProduct);
                } else {
                    renderExecutionAutocomplete();
                    const list = el("expiredExecutionAutocomplete");
                    if (list && !query) list.hidden = true;
                }
                return;
            }

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
            input.placeholder = "Search....";
            input.focus();
            setLookupMessage(
                "Mode scanner fisik aktif. Pindai barcode ke kolom ini, " +
                "lalu pastikan scanner mengirim tombol Enter."
            );
        });
        el("expiredCameraTorch")?.addEventListener("click", async () => {
            const scanner = state.html5QrCode;
            const button = el("expiredCameraTorch");
            if (!scanner || !state.cameraActive || !button) return;

            const nextTorchState = !state.cameraTorch;

            try {
                await scanner.applyVideoConstraints({
                    torch: nextTorchState,
                    advanced: [{ torch: nextTorchState }]
                });

                state.cameraTorch = nextTorchState;
                button.classList.toggle("is-active", nextTorchState);
                button.textContent = nextTorchState ? "⚡̸" : "⚡";
            } catch (error) {
                const status = el("expiredCameraStatus");
                if (status) {
                    status.textContent =
                        "Perangkat atau browser tidak mendukung senter.";
                }
            }
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
            } else if (
                el("expiredExecutionModal") &&
                !el("expiredExecutionModal").hidden
            ) {
                closeExecutionModal();
            } else if (el("expiredModal") && !el("expiredModal").hidden) {
                closeModal();
            } else if (
                el("expiredDetailView") &&
                !el("expiredDetailView").hidden
            ) {
                closeDetailView();
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
