from odoo import fields, models


class StockQuant(models.Model):
    _inherit = "stock.quant"

    product_description = fields.Html(
        string="Product Description",
        related="product_tmpl_id.description",
    )
