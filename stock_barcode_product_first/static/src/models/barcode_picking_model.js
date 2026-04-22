import BarcodePickingModel from "@stock_barcode/models/barcode_picking_model";
import { patch } from "@web/core/utils/patch";

patch(BarcodePickingModel.prototype, {
    get useProductFirstGrouping() {
        return true;
    },

    /**
     * Sort lines by product first, then by source location within each product.
     * Completed lines are still pushed to the bottom.
     */
    _sortingMethod(l1, l2) {
        const l1IsCompleted = this._lineIsComplete(l1);
        const l2IsCompleted = this._lineIsComplete(l2);
        if (!l1IsCompleted && l2IsCompleted) {
            return -1;
        } else if (l1IsCompleted && !l2IsCompleted) {
            return 1;
        }
        // Sort by product category.
        const categ1 = l1.product_category_name;
        const categ2 = l2.product_category_name;
        if (categ1 < categ2) {
            return -1;
        } else if (categ1 > categ2) {
            return 1;
        }
        // Sort by product name.
        const product1 = l1.product_id.display_name;
        const product2 = l2.product_id.display_name;
        if (product1 < product2) {
            return -1;
        } else if (product1 > product2) {
            return 1;
        }
        // Within the same product, sort by source location.
        const sourceLocation1 = l1.location_id.display_name;
        const sourceLocation2 = l2.location_id.display_name;
        if (sourceLocation1 < sourceLocation2) {
            return -1;
        } else if (sourceLocation1 > sourceLocation2) {
            return 1;
        }
        // Sort by (source) package.
        const package1 = l1.package_id.name;
        const package2 = l2.package_id.name;
        if (package1 < package2) {
            return -1;
        } else if (package1 > package2) {
            return 1;
        }
        return 0;
    },

    /**
     * Returns lines grouped by product instead of by location.
     * Each group has a `product` key and its `lines` sorted by source location.
     */
    get groupedLinesByProduct() {
        const lines = [].concat(this.groupedLines, this.packageLines);
        const linesByProducts = [];
        const linesByProduct = {};
        for (const line of lines) {
            const productId = line.product_id.id;
            if (!linesByProduct[productId]) {
                linesByProduct[productId] = {
                    product: line.product_id,
                    lines: [],
                };
            }
            if (!linesByProducts.includes(linesByProduct[productId])) {
                linesByProducts.push(linesByProduct[productId]);
            }
            linesByProduct[productId].lines.push(line);
        }
        // Sort groups alphabetically by product name.
        linesByProducts.sort((a, b) => {
            const [nameA, nameB] = [a.product.display_name, b.product.display_name];
            return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
        });
        return linesByProducts;
    },
});
