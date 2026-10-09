/* =========================================
   MASTER PRODUK
========================================= */


/* =========================================
   DATABASE INDEXEDDB
========================================= */

const PRODUCT_DB_NAME = "ToolsTokoDB";
const PRODUCT_DB_VERSION = 1;
const PRODUCT_STORE = "masterProduk";

let productDB = null;


/* =========================================
   PAGINATION
========================================= */

const PRODUCTS_PER_PAGE = 50;

let currentProductPage = 1;
let currentProductSearch = "";

let totalProductData = 0;

// Cache Master Produk di memori
let productCache = null;

/* =========================================
   BUKA DATABASE
========================================= */

function openProductDatabase() {

    return new Promise(function(resolve, reject) {

        const request = indexedDB.open(
            PRODUCT_DB_NAME,
            PRODUCT_DB_VERSION
        );


        request.onupgradeneeded = function(event) {

            const db = event.target.result;


            if (
                !db.objectStoreNames.contains(
                    PRODUCT_STORE
                )
            ) {

                const store =
                    db.createObjectStore(
                        PRODUCT_STORE,
                        {
                            keyPath: "kode"
                        }
                    );


                store.createIndex(
                    "nama",
                    "nama",
                    {
                        unique: false
                    }
                );

            }

        };


        request.onsuccess = function(event) {

            productDB =
                event.target.result;

            resolve(productDB);

        };


        request.onerror = function() {

            reject(
                request.error
            );

        };

    });

}


/* =========================================
   SIMPAN PRODUK
========================================= */

function saveProducts(products) {

    return new Promise(function(resolve, reject) {

        const transaction =
            productDB.transaction(
                PRODUCT_STORE,
                "readwrite"
            );

        const store =
            transaction.objectStore(
                PRODUCT_STORE
            );


        /* Hapus data Master Produk lama */

        const clearRequest =
            store.clear();


        clearRequest.onerror = function() {

            reject(
                clearRequest.error
            );

        };


        clearRequest.onsuccess = function() {

            products.forEach(function(product) {

                store.put(product);

            });

        };


        transaction.oncomplete = function() {

            resolve();

        };


        transaction.onerror = function() {

            reject(
                transaction.error
            );

        };

    });

}


/* =========================================
   HITUNG DATA
========================================= */

function countProducts() {

    return new Promise(function(resolve, reject) {

        const transaction =
            productDB.transaction(
                PRODUCT_STORE,
                "readonly"
            );

        const store =
            transaction.objectStore(
                PRODUCT_STORE
            );

        const request =
            store.count();


        request.onsuccess = function() {

            resolve(
                request.result
            );

        };


        request.onerror = function() {

            reject(
                request.error
            );

        };

    });

}


/* =========================================
   AMBIL SEMUA PRODUK
========================================= */

function getAllProducts() {

    return new Promise(function(resolve, reject) {

        const transaction =
            productDB.transaction(
                PRODUCT_STORE,
                "readonly"
            );

        const store =
            transaction.objectStore(
                PRODUCT_STORE
            );

        const request =
            store.getAll();


        request.onsuccess = function() {

            resolve(
                request.result
            );

        };


        request.onerror = function() {

            reject(
                request.error
            );

        };

    });

}


/* =========================================
   BERSIHKAN NILAI
========================================= */

function cleanValue(value) {

    if (
        value === undefined ||
        value === null
    ) {

        return "";

    }


    return String(value).trim();

}


/* =========================================
   BERSIHKAN KODE PRODUK
========================================= */

function cleanCode(value) {

    if (
        value === undefined ||
        value === null
    ) {

        return "";

    }


    let code =
        String(value).trim();


    /*
       Hapus apostrof di awal.
       Contoh:
       '8994455980104
       menjadi:
       8994455980104
    */

    code =
        code.replace(
            /^'/,
            ""
        );


    /*
       Hilangkan .0 jika Excel
       membacanya sebagai angka.
    */

    if (
        /^\d+\.0$/.test(code)
    ) {

        code =
            code.replace(
                ".0",
                ""
            );

    }


    return code;

}


/* =========================================
   FORMAT HARGA
========================================= */

function formatPrice(value) {

    if (
        value === "" ||
        value === null ||
        value === undefined
    ) {

        return "";

    }


    const number =
        Number(value);


    if (
        Number.isNaN(number)
    ) {

        return String(value);

    }


    return new Intl.NumberFormat(
        "id-ID"
    ).format(number);

}


/* =========================================
   UPLOAD / BACA EXCEL
========================================= */

async function handleProductUpload(file) {

    if (!file) {

        return;

    }


    if (
        typeof XLSX === "undefined"
    ) {

        alert(
            "Library Excel belum berhasil dimuat."
        );

        return;

    }


    try {

      showProductLoading(
    "Produk sedang di muat..."
);


        const buffer =
            await file.arrayBuffer();


        const workbook =
            XLSX.read(
                buffer,
                {
                    type: "array"
                }
            );


        const firstSheet =
            workbook.Sheets[
                workbook.SheetNames[0]
            ];


        const rows =
            XLSX.utils.sheet_to_json(
                firstSheet,
                {
                    defval: "",
                    raw: true
                }
            );


        if (
            !rows.length
        ) {

            alert(
                "File tidak berisi data."
            );

            hideProductLoading();

            return;

        }


        const products =
            rows
                .map(function(row) {

                    return {

                        no:
                            cleanValue(
                                row["No."]
                            ),

                        kode:
                            cleanCode(
                                row["Kode"]
                            ),

                        nama:
                            cleanValue(
                                row["Nama"]
                            ),

                        principle:
                            cleanValue(
                                row["Principle"]
                            ),

                        namaPrinciple:
                            cleanValue(
                                row["Nama Principle"]
                            ),

                        supplier:
                            cleanValue(
                                row["Supplier"]
                            ),

                        namaSupplier:
                            cleanValue(
                                row["Nama Supplier"]
                            ),

                        kategori:
                            cleanValue(
                                row["Kategori"]
                            ),

                        hpp:
                            cleanValue(
                                row["Hpp"]
                            ),

                        hrg1:
                            cleanValue(
                                row["Hrg1"]
                            ),

                        hrg2:
                            cleanValue(
                                row["Hrg2"]
                            ),

                        hrg3:
                            cleanValue(
                                row["Hrg3"]
                            )

                    };

                })
                .filter(function(product) {

                    return (
                        product.kode !== ""
                    );

                });


        if (
            !products.length
        ) {

            alert(
                "Kolom Kode tidak ditemukan atau kosong."
            );

            hideProductLoading();

            return;

        }


        await saveProducts(
            products
        );

      // Perbarui cache dengan data terbaru
     productCache =
       products.slice();


        currentProductPage = 1;
        currentProductSearch = "";


        const searchInput =
            document.getElementById(
                "productSearch"
            );


        if (searchInput) {

            searchInput.value = "";

        }


        await renderProducts();
      
      showProductLoadingSuccess(
        products.length
);

setTimeout(function() {

    hideProductLoading();

}, 1200);

      

    } catch (error) {

        console.error(
            "Gagal membaca Master Produk:",
            error
        );


        alert(
            "Gagal membaca file Excel.\n\n" +
            error.message
        );

    }

}


/* =========================================
   TAMPILKAN PRODUK
========================================= */

async function renderProducts() {

    const tbody =
        document.getElementById(
            "productTableBody"
        );


    if (!tbody) {

        return;

    }


// =========================================
// AMBIL DATA DARI CACHE
// Database hanya dibaca sekali
// =========================================

if (productCache === null) {

    productCache =
        await getAllProducts();


    // =====================================
    // URUTKAN SEPERTI POS
    // Berdasarkan Nama
    // Jika Nama sama → berdasarkan Kode
    // =====================================

    productCache.sort(function(a, b) {

        const namaA =
            String(a.nama || "");

        const namaB =
            String(b.nama || "");


        const namaCompare =
            namaA.localeCompare(
                namaB,
                "id",
                {
                    numeric: true,
                    sensitivity: "base"
                }
            );


        // Jika nama berbeda
        if (namaCompare !== 0) {
            return namaCompare;
        }


        // Jika nama sama → berdasarkan Kode
        return String(a.kode || "").localeCompare(
            String(b.kode || ""),
            "id",
            {
                numeric: true,
                sensitivity: "base"
            }
        );

    });

}


const allProducts =
    productCache;


totalProductData =
    allProducts.length;


let filteredProducts =
    allProducts;

    /* SEARCH */

    if (
        currentProductSearch
    ) {

        const search =
            currentProductSearch
                .toLowerCase();


        filteredProducts =
            allProducts.filter(
                function(product) {

                    return (

                        product.kode
                            .toLowerCase()
                            .includes(search)

                        ||

                        product.nama
                            .toLowerCase()
                            .includes(search)

                    );

                }
            );

    }


    const totalPages =
        Math.ceil(
            filteredProducts.length /
            PRODUCTS_PER_PAGE
        );


    if (
        totalPages > 0 &&
        currentProductPage > totalPages
    ) {

        currentProductPage =
            totalPages;

    }


    if (
        totalPages === 0
    ) {

        currentProductPage = 1;

    }


    const start =
        (
            currentProductPage - 1
        ) *
        PRODUCTS_PER_PAGE;


    const end =
        start +
        PRODUCTS_PER_PAGE;


    const pageProducts =
        filteredProducts.slice(
            start,
            end
        );


    tbody.innerHTML = "";


    if (
        !pageProducts.length
    ) {

        tbody.innerHTML = `
            <tr>
                <td
                    colspan="12"
                    class="product-empty">
                    Data produk tidak ditemukan.
                </td>
            </tr>
        `;

    } else {

        pageProducts.forEach(
    function(product, index) {
                const row =
                    document.createElement(
                        "tr"
                    );


                row.innerHTML = `

                    <td>
                        ${start + index + 1}
                    </td>

                    <td class="product-code">
                        ${escapeHtml(product.kode)}
                    </td>

                    <td class="product-name">
                        ${escapeHtml(product.nama)}
                    </td>

                    <td>
                        ${escapeHtml(product.principle)}
                    </td>

                    <td>
                        ${escapeHtml(product.namaPrinciple)}
                    </td>

                    <td>
                        ${escapeHtml(product.supplier)}
                    </td>

                    <td>
                        ${escapeHtml(product.namaSupplier)}
                    </td>

                    <td>
                        ${escapeHtml(product.kategori)}
                    </td>

                    <td class="price-cell">
                        ${formatPrice(product.hpp)}
                    </td>

                    <td class="price-cell">
                        ${formatPrice(product.hrg1)}
                    </td>

                    <td class="price-cell">
                        ${formatPrice(product.hrg2)}
                    </td>

                    <td class="price-cell">
                        ${formatPrice(product.hrg3)}
                    </td>

                `;


                tbody.appendChild(
                    row
                );

            }
        );

    }


    updateProductInfo(
        allProducts.length,
        filteredProducts.length
    );


    updateProductPagination(
        totalPages
    );

}


/* =========================================
   ESCAPE HTML
========================================= */

function escapeHtml(value) {

    return String(value)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================
   INFO DATA
========================================= */

function updateProductInfo(
    total,
    filtered
) {

    const info =
        document.getElementById(
            "masterProductInfo"
        );


    if (!info) {

        return;

    }


    if (!total) {

        info.textContent =
            "Belum ada data produk.";

        return;

    }


    if (
        currentProductSearch
    ) {

        info.textContent =
            `${filtered.toLocaleString("id-ID")} hasil dari ${total.toLocaleString("id-ID")} produk`;

    } else {

        info.textContent =
            `${total.toLocaleString("id-ID")} produk`;

    }

}


/* =========================================
   PAGINATION
========================================= */

function updateProductPagination(
    totalPages
) {

    const pageInfo =
        document.getElementById(
            "productPageInfo"
        );


    const prev =
        document.getElementById(
            "prevProductPage"
        );


    const next =
        document.getElementById(
            "nextProductPage"
        );


    if (pageInfo) {

        pageInfo.textContent =
            totalPages > 0
                ? `Halaman ${currentProductPage} dari ${totalPages}`
                : "Halaman 0";

    }


    if (prev) {

        prev.disabled =
            currentProductPage <= 1;

    }


    if (next) {

        next.disabled =
            currentProductPage >= totalPages;

    }

}


/* =========================================
   LOADING POPUP
========================================= */

function showProductLoading(message = "Loading") {

    let popup =
        document.getElementById(
            "productLoadingPopup"
        );

    if (!popup) {

        popup =
            document.createElement("div");

        popup.id =
            "productLoadingPopup";

        document.body.appendChild(popup);
    }

    popup.innerHTML = `
        <div class="product-loading-box">

            <div class="product-loading-spinner"></div>

            <div class="product-loading-text">
                ${message}
            </div>

        </div>
    `;

    popup.classList.remove("success");

    popup.classList.add("show");
}

function showProductLoadingSuccess(total) {

    const popup =
        document.getElementById(
            "productLoadingPopup"
        );

    if (!popup) {
        return;
    }

    popup.innerHTML = `
        <div class="product-loading-box success">

            <div class="product-loading-check">
                ✓
            </div>

            <div class="product-loading-text">
                ${total.toLocaleString("id-ID")} produk berhasil di muat
            </div>

        </div>
    `;

    popup.classList.add("success");
}


function hideProductLoading() {

    const popup =
        document.getElementById(
            "productLoadingPopup"
        );

    if (popup) {

        popup.classList.remove("show");

    }
  

}


/* =========================================
   EVENT UPLOAD
========================================= */

const productFile =
    document.getElementById(
        "productFile"
    );


if (productFile) {

    productFile.addEventListener(
        "change",
        function(event) {

            const file =
                event.target.files[0];


            handleProductUpload(
                file
            );


            event.target.value = "";

        }
    );

}


/* =========================================
   EVENT SEARCH
========================================= */

const productSearch =
    document.getElementById(
        "productSearch"
    );


if (productSearch) {

    let searchTimer = null;

    productSearch.addEventListener(
        "input",
        function() {

            currentProductSearch =
                this.value.trim();

            currentProductPage = 1;


            // Batalkan pencarian sebelumnya
            clearTimeout(searchTimer);


            // Tunggu sebentar setelah user berhenti mengetik
            searchTimer = setTimeout(
                function() {

                    renderProducts();

                },
                100
            );

        }
    );

}

/* =========================================
   EVENT PAGINATION
========================================= */

const prevProductPage =
    document.getElementById(
        "prevProductPage"
    );


const nextProductPage =
    document.getElementById(
        "nextProductPage"
    );


if (prevProductPage) {

    prevProductPage.addEventListener(
        "click",
        function() {

            if (
                currentProductPage > 1
            ) {

                currentProductPage--;

                renderProducts();

            }

        }
    );

}


if (nextProductPage) {

    nextProductPage.addEventListener(
        "click",
        function() {

            currentProductPage++;

            renderProducts();

        }
    );

}


/* =========================================
   HAPUS SEMUA DATA
========================================= */

const clearProductData =
    document.getElementById(
        "clearProductData"
    );


if (clearProductData) {

    clearProductData.addEventListener(
        "click",
        async function() {

            const total =
                await countProducts();


            if (!total) {

                alert(
                    "Belum ada data Master Produk."
                );

                return;

            }


            const yakin =
                confirm(
                    `Hapus ${total.toLocaleString("id-ID")} data Master Produk?`
                );


            if (!yakin) {

                return;

            }


            const transaction =
                productDB.transaction(
                    PRODUCT_STORE,
                    "readwrite"
                );


            transaction
                .objectStore(
                    PRODUCT_STORE
                )
                .clear();


            transaction.oncomplete =
                function() {

                    currentProductPage = 1;

                    productCache = [];

                    currentProductSearch = "";

                    const searchInput =
                        document.getElementById(
                            "productSearch"
                        );


                    if (searchInput) {

                        searchInput.value = "";

                    }


                    renderProducts();


                    alert(
                        "Data Master Produk berhasil dihapus."
                    );

         };

        }
    );

}


/* =========================================
   INISIALISASI
========================================= */

async function initMasterProduk(
    showLoading = false
) {

    if (showLoading) {

        showProductLoading("Loading");

    }

    try {

        await openProductDatabase();

        await renderProducts();

        if (showLoading) {

            if (totalProductData > 0) {

                showProductLoadingSuccess(
                    totalProductData
                );

                setTimeout(function() {

                    hideProductLoading();

                }, 1200);

            } else {

                hideProductLoading();

            }

        }

    } catch (error) {

        console.error(
            "Database Master Produk gagal dibuka:",
            error
        );

        if (showLoading) {

            hideProductLoading();

        }

    }

}

const navigationEntry =
    performance.getEntriesByType(
        "navigation"
    )[0];

const isPageRefresh =
    navigationEntry &&
    navigationEntry.type === "reload";


if (
    window.location.hash === "#master-data"
) {

    initMasterProduk(
        isPageRefresh
    );

}