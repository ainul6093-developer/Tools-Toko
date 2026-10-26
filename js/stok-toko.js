/* =========================================
   TOOLS TOKO - STOK TOKO
   Logika halaman mandiri; penyimpanan tetap terpisah
========================================= */
(function () {
    const DB_NAME = "ToolsTokoStockDB";
    const DB_VERSION = 1;
    const PAGE_SIZE = 50;
    const cfg = {
        store: "stokToko",
        title: "Stok Toko",
        fileId: "stokTokoFile",
        uploadId: "uploadStokTokoBtn",
        searchId: "stokTokoSearch",
        bodyId: "stokTokoTableBody",
        countId: "stokTokoCount",
        statusId: "stokTokoStatus",
        prevId: "stokTokoPrev",
        nextId: "stokTokoNext",
        pageInfoId: "stokTokoPageInfo"
    };
    const headers = ["No.", "KODE", "NAMA", "RAK", "STOK", "HPP", "NILAI"];
    const state = { rows: [], page: 1, initialized: false };

    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                ["stokToko", "stokGudang"].forEach(name => {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(
                            name,
                            { keyPath: "id", autoIncrement: true }
                        );
                    }
                });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () =>
                reject(request.error || new Error("Database tidak dapat dibuka."));
        });
    }

    function getRows(storeName) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
            tx.oncomplete = () => db.close();
            tx.onerror = () => {
                db.close();
                reject(tx.error);
            };
        }));
    }

    function replaceRows(storeName, rows) {
        return openDB().then(db => new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, "readwrite");
            const store = tx.objectStore(storeName);
            store.clear();
            rows.forEach(row => store.add(row));
            tx.oncomplete = () => {
                db.close();
                resolve();
            };
            tx.onerror = () => {
                db.close();
                reject(tx.error || new Error("Gagal menyimpan data."));
            };
            tx.onabort = () => {
                db.close();
                reject(tx.error || new Error("Penyimpanan dibatalkan."));
            };
        }));
    }

    function normalizeRows(matrix) {
        if (!matrix || matrix.length < 2) {
            throw new Error("File Excel tidak memiliki baris data.");
        }
        const first = matrix[0].map(v => String(v ?? "").trim().toUpperCase());
        const aliases = {
            "NO.": ["NO", "NO."],
            "KODE": ["KODE", "KODE BARANG", "BARCODE", "PLU"],
            "NAMA": ["NAMA", "NAMA BARANG", "DESKRIPSI"],
            "RAK": ["RAK", "LOKASI"],
            "STOK": ["STOK", "QTY", "JUMLAH"],
            "HPP": ["HPP", "HARGA POKOK"],
            "NILAI": ["NILAI", "TOTAL NILAI"]
        };
        const positions = {};
        headers.forEach(h => {
            const aliasesForHeader = aliases[h] || [h];
            positions[h] = first.findIndex(v => aliasesForHeader.includes(v));
        });
        const hasKnownHeaders = positions["KODE"] >= 0 && positions["NAMA"] >= 0;
        const dataStart = hasKnownHeaders ? 1 : 0;
        if (!hasKnownHeaders) {
            headers.forEach((h, i) => positions[h] = i);
        }
        const rows = [];
        for (let i = dataStart; i < matrix.length; i++) {
            const line = matrix[i];
            if (
                !line ||
                line.every(v => v === null || v === undefined || String(v).trim() === "")
            ) {
                continue;
            }
            const row = {};
            headers.forEach(h => {
                const pos = positions[h];
                let value = pos >= 0 ? line[pos] : "";
                if (value === null || value === undefined) value = "";
                row[h] = value;
            });
            if (!String(row.KODE).trim() && !String(row.NAMA).trim()) continue;
            rows.push(row);
        }
        if (!rows.length) {
            throw new Error("Tidak ditemukan data barang di file tersebut.");
        }
        return rows;
    }

    function formatNumber(value) {
        if (typeof value === "number") {
            return value.toLocaleString(
                "id-ID",
                { maximumFractionDigits: 2 }
            );
        }
        const text = String(value ?? "").trim();
        if (!text) return "—";
        return text;
    }

    function setStatus(cfg, message, isError) {
        const el = document.getElementById(cfg.statusId);
        if (!el) return;
        el.textContent = message;
        el.classList.toggle("is-error", !!isError);
        el.classList.toggle("is-success", !isError && !!message);
    }

    function render(cfg) {
        const s = state;
        if (!s.initialized) return;
        const body = document.getElementById(cfg.bodyId);
        const count = document.getElementById(cfg.countId);
        const pageInfo = document.getElementById(cfg.pageInfoId);
        const prev = document.getElementById(cfg.prevId);
        const next = document.getElementById(cfg.nextId);
        if (!body) return;

        const q = (document.getElementById(cfg.searchId)?.value || "")
            .trim()
            .toLocaleLowerCase("id-ID");
        const filtered = !q
            ? s.rows
            : s.rows.filter(row =>
                headers.some(h =>
                    String(row[h] ?? "").toLocaleLowerCase("id-ID").includes(q)
                )
            );
        const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
        s.page = Math.min(Math.max(1, s.page), pages);
        const start = (s.page - 1) * PAGE_SIZE;
        const shown = filtered.slice(start, start + PAGE_SIZE);
        body.innerHTML = "";
        if (!shown.length) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = headers.length;
            td.className = "stock-empty-cell";
            td.textContent = s.rows.length
                ? "Data tidak ditemukan."
                : "Belum ada data stok. Silakan upload file Excel.";
            tr.appendChild(td);
            body.appendChild(tr);
        } else {
            shown.forEach((row, index) => {
                const tr = document.createElement("tr");
                headers.forEach((h, colIndex) => {
                    const td = document.createElement("td");
                    let value = row[h];
                    if (h === "No.") value = start + index + 1;
                    td.textContent =
                        h === "STOK" || h === "HPP" || h === "NILAI"
                            ? formatNumber(value)
                            : (value === "" ? "—" : String(value));
                    if (h === "KODE") td.className = "stock-code-cell";
                    tr.appendChild(td);
                });
                body.appendChild(tr);
            });
        }
        if (count) {
            count.textContent = `${filtered.length.toLocaleString("id-ID")} barang`;
        }
        if (pageInfo) pageInfo.textContent = `Halaman ${s.page} dari ${pages}`;
        if (prev) prev.disabled = s.page <= 1;
        if (next) next.disabled = s.page >= pages;
    }

    function initConfig() {
        if (state.initialized) {
            render(cfg);
            return;
        }
        state.initialized = true;
        getRows(cfg.store).then(rows => {
            state.rows = rows;
            render(cfg);
        }).catch(err => {
            setStatus(cfg, "Data belum dapat dibaca: " + err.message, true);
            render(cfg);
        });

        document.getElementById(cfg.searchId)?.addEventListener("input", () => {
            state.page = 1;
            render(cfg);
        });
        document.getElementById(cfg.prevId)?.addEventListener("click", () => {
            state.page = Math.max(1, state.page - 1);
            render(cfg);
        });
        document.getElementById(cfg.nextId)?.addEventListener("click", () => {
            state.page++;
            render(cfg);
        });
        document.getElementById(cfg.uploadId)?.addEventListener(
            "click",
            () => document.getElementById(cfg.fileId)?.click()
        );
        document.getElementById(cfg.fileId)?.addEventListener("change", async event => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (typeof XLSX === "undefined") {
                setStatus(
                    cfg,
                    "Pembaca Excel belum tersedia. Periksa koneksi internet " +
                    "lalu refresh.",
                    true
                );
                event.target.value = "";
                return;
            }
            setStatus(cfg, "Sedang membaca file Excel...", false);
            const button = document.getElementById(cfg.uploadId);
            if (button) {
                button.disabled = true;
                button.textContent = "Memuat...";
            }
            try {
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: "array" });
                const sheet = workbook.Sheets[workbook.SheetNames[0]];
                const matrix = XLSX.utils.sheet_to_json(
                    sheet,
                    { header: 1, defval: "", raw: true }
                );
                const rows = normalizeRows(matrix);
                await replaceRows(cfg.store, rows);
                state.rows = rows;
                state.page = 1;
                render(cfg);
                if (typeof window.invalidateExpiredLookups === "function") {
                    window.invalidateExpiredLookups();
                }
                setStatus(
                    cfg,
                    `${rows.length.toLocaleString("id-ID")} barang berhasil dimuat.`,
                    false
                );
            } catch (err) {
                setStatus(
                    cfg,
                    "Gagal memuat file: " + (err.message || "format tidak sesuai."),
                    true
                );
            } finally {
                if (button) {
                    button.disabled = false;
                    button.textContent = "↑ Upload Excel";
                }
                event.target.value = "";
            }
        });
    }

    window.initStokTokoPage = function () {
        initConfig();
    };

})();
