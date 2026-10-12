-- Staff access: two new roles (storekeeper, librarian) and per-person extra access on top of any role.
-- Procurement (suppliers, LPOs, goods received, supplier invoices), the store and the library.
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('super_admin','school_admin','principal','bursar','teacher','class_teacher','storekeeper','librarian'));
-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "attachmentUrl" TEXT,
ADD COLUMN     "supplierId" UUID,
ADD COLUMN     "supplierInvoiceId" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "kraPin" TEXT,
    "address" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "supplierId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "neededBy" DATE,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "total" DECIMAL(14,2) NOT NULL,
    "createdBy" UUID NOT NULL,
    "decidedBy" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "storeItemId" UUID,
    "description" TEXT NOT NULL,
    "unit" TEXT,
    "quantity" DECIMAL(12,2) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "receivedQty" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL,

    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "deliveryNote" TEXT,
    "note" TEXT,
    "lines" JSONB NOT NULL,
    "receivedBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "supplierId" UUID NOT NULL,
    "orderId" UUID,
    "invoiceNo" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "dueDate" DATE,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "attachmentUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "voidReason" TEXT,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_items" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "reorderLevel" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "unitCost" DECIMAL(14,2),
    "location" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "store_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DECIMAL(12,2) NOT NULL,
    "balanceAfter" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(14,2),
    "date" DATE NOT NULL,
    "issuedTo" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "orderId" UUID,
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_books" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "isbn" TEXT,
    "publisher" TEXT,
    "category" TEXT NOT NULL,
    "subject" TEXT,
    "level" TEXT,
    "shelf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_copies" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "bookId" UUID NOT NULL,
    "accessionNo" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'available',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_copies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_loans" (
    "id" UUID NOT NULL,
    "schoolId" UUID NOT NULL,
    "copyId" UUID NOT NULL,
    "studentId" UUID,
    "userId" UUID,
    "borrowerName" TEXT NOT NULL,
    "issuedAt" DATE NOT NULL,
    "dueDate" DATE NOT NULL,
    "returnedAt" DATE,
    "status" TEXT NOT NULL DEFAULT 'out',
    "returnNote" TEXT,
    "issuedBy" UUID NOT NULL,
    "returnedBy" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_loans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_schoolId_name_key" ON "suppliers"("schoolId", "name");

-- CreateIndex
CREATE INDEX "purchase_orders_schoolId_status_idx" ON "purchase_orders"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_orders_schoolId_number_key" ON "purchase_orders"("schoolId", "number");

-- CreateIndex
CREATE INDEX "purchase_order_lines_orderId_idx" ON "purchase_order_lines"("orderId");

-- CreateIndex
CREATE INDEX "goods_receipts_orderId_idx" ON "goods_receipts"("orderId");

-- CreateIndex
CREATE INDEX "supplier_invoices_schoolId_status_idx" ON "supplier_invoices"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_schoolId_supplierId_invoiceNo_key" ON "supplier_invoices"("schoolId", "supplierId", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "store_items_schoolId_name_key" ON "store_items"("schoolId", "name");

-- CreateIndex
CREATE INDEX "stock_movements_schoolId_date_idx" ON "stock_movements"("schoolId", "date");

-- CreateIndex
CREATE INDEX "stock_movements_itemId_createdAt_idx" ON "stock_movements"("itemId", "createdAt");

-- CreateIndex
CREATE INDEX "library_books_schoolId_title_idx" ON "library_books"("schoolId", "title");

-- CreateIndex
CREATE INDEX "library_copies_bookId_idx" ON "library_copies"("bookId");

-- CreateIndex
CREATE UNIQUE INDEX "library_copies_schoolId_accessionNo_key" ON "library_copies"("schoolId", "accessionNo");

-- CreateIndex
CREATE INDEX "library_loans_schoolId_status_idx" ON "library_loans"("schoolId", "status");

-- CreateIndex
CREATE INDEX "library_loans_copyId_idx" ON "library_loans"("copyId");

-- CreateIndex
CREATE INDEX "library_loans_studentId_idx" ON "library_loans"("studentId");

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "store_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "library_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_copyId_fkey" FOREIGN KEY ("copyId") REFERENCES "library_copies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every new table belongs to one school.
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts" ADD CONSTRAINT "goods_receipts_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_books" ADD CONSTRAINT "library_books_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "students"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_storeItemId_fkey" FOREIGN KEY ("storeItemId") REFERENCES "store_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "expenses_supplierInvoiceId_idx" ON "expenses"("supplierInvoiceId");

-- Allowed values and sane amounts.
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_status_check" CHECK ("status" IN ('pending','approved','rejected','partly_received','received','cancelled'));
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_total_check" CHECK ("total" > 0);
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_amounts_check" CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "receivedQty" >= 0 AND "receivedQty" <= "quantity");
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_status_check" CHECK ("status" IN ('active','voided'));
ALTER TABLE "store_items" ADD CONSTRAINT "store_items_quantity_check" CHECK ("quantity" >= 0 AND "reorderLevel" >= 0);
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_type_check" CHECK ("type" IN ('receive','issue','return','adjust'));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_quantity_check" CHECK ("quantity" <> 0 AND "balanceAfter" >= 0);
ALTER TABLE "library_copies" ADD CONSTRAINT "library_copies_status_check" CHECK ("status" IN ('available','on_loan','lost','damaged','withdrawn'));
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_status_check" CHECK ("status" IN ('out','returned','lost'));
ALTER TABLE "library_loans" ADD CONSTRAINT "library_loans_borrower_check" CHECK (("studentId" IS NOT NULL) <> ("userId" IS NOT NULL));
-- A copy can be out on at most one loan at a time.
CREATE UNIQUE INDEX "library_loans_one_open_per_copy" ON "library_loans"("copyId") WHERE "status" = 'out';
