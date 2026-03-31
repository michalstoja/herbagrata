###################################################################################
#
#    Copyright (c) 2022 Radovan Skolnik, Data Dance s.r.o.
#
#    Data Dance Proprietary License v1.0
#
#    This software and associated files (the "Software") may only be used
#    (executed, modified, executed after modifications) if you have
#    purchased a valid license from Data Dance s.r.o.
#
#    The above permissions are granted for a single database per purchased
#    license. Furthermore, with a valid license it is permitted to use the
#    software on other databases as long as the usage is limited to a testing
#    or development environment.
#
#    You may develop modules based on the Software or that use the Software
#    as a library (typically by depending on it, importing it and using its
#    resources), but without copying any source code or material from the
#    Software. You may distribute those modules under the license of your
#    choice, provided that this license is compatible with the terms of the
#    Data Dance Proprietary License (For example: LGPL, MIT, or proprietary
#    licenses similar to this one).
#
#    It is forbidden to publish, distribute, sublicense, or sell copies of
#    the Software or modified copies of the Software.
#
#    The above copyright notice and this permission notice must be included
#    in all copies or substantial portions of the Software.
#
#    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
#    OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
#    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
#    THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
#    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
#    FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
#    DEALINGS IN THE SOFTWARE.
#
###################################################################################

import logging

from odoo import Command, _, api, fields, models
from odoo.exceptions import UserError
from odoo.fields import Command

_logger = logging.getLogger(__name__)


class ResPartner(models.Model):
    _inherit = "res.partner"

    partner_gid = fields.Char("Company database ID")

    partner_autocomplete_provider = fields.Char(
        "Partner Autocomplete Provider",
    )

    import_enrich_company = fields.Char(
        "Import Enrich Company",
        inverse="_update_partner_info",
        store=False,
        default=False,
    )

    def _update_partner_info(self):
        for partner in self:
            model = self.env.get(
                partner.partner_autocomplete_provider, None
            ) or self.env.get(self.env.company.partner_autocomplete_provider, None)
            if model is not None:
                try:
                    data = model.enrich_company(
                        vat="",
                        partner_gid=partner.partner_gid
                        or partner.import_enrich_company,
                        company_domain="",
                    )
                    if data:
                        partner.write(self._process_partner_data(data))
                except Exception as e:
                    _logger.warning(
                        f"Error while updating partner info: {partner.name} ({e})"
                    )
                    print(e)
            else:
                raise UserError(
                    f"The provider ({partner.partner_autocomplete_provider}) is not installed."
                )

    def _process_partner_data(self, data):
        if "child_ids" in data:
            existing_partners = self.env["res.partner"].search([]).mapped("name")
            for child in data["child_ids"]:
                if isinstance(child[2], dict):
                    if child[0].value == 0 and "country_id" in child[2]:
                        child[2]["country_id"] = child[2]["country_id"].get("id", "")

            data["child_ids"] = [
                i
                for i in data["child_ids"]
                if isinstance(i[2], dict)
                and i[2].get("name", False) not in existing_partners
            ]
        if "bank_ids" in data:
            existing_acc_numbers = (
                self.env["res.partner.bank"].search([]).mapped("sanitized_acc_number")
            )
            bank_ids = []
            for bank in data["bank_ids"]:
                if (
                    isinstance(bank[2], dict)
                    and bank[2]["acc_number"] not in existing_acc_numbers
                ):
                    if "bank_id" in bank[2] and bank[2]["bank_id"]:
                        bank_id = bank[2]["bank_id"].get("id", False)
                        bank[2]["bank_id"] = bank_id
                    bank_ids.append(bank)
            data["bank_ids"] = bank_ids

        if "country_id" in data and data["country_id"] and "id" in data["country_id"]:
            data["country_id"] = data["country_id"].get("id", "")
        if (
            "industry_id" in data
            and data["industry_id"]
            and "id" in data["industry_id"]
        ):
            data["industry_id"] = data["industry_id"].get("id", "")
        if "state_id" in data and data["state_id"] and "id" in data["state_id"]:
            data["state_id"] = data["state_id"].get("id", "")
        return data

    @api.model
    def default_get(self, default_fields):
        new_context = self.prepare_new_context()
        if new_context:
            return super().with_context(**new_context).default_get(default_fields)
        return super().default_get(default_fields)

    def prepare_new_context(self):
        new_context = {}
        fields = ["default_bank_ids", "default_child_ids"]

        def process_context_data(key):
            if (
                key in self.env.context
                and "operation" in self.env.context[key]
                and self.env.context[key]["operation"] == "MULTI"
            ):
                try:
                    new_data = [
                        Command.create(i["data"])
                        for i in self.env.context[key]["commands"]
                        if i["operation"] == "CREATE"
                    ]
                    new_context[key] = new_data
                except Exception as e:
                    pass

        for field in fields:
            process_context_data(field)

        return new_context

    @api.model_create_multi
    def create(self, vals_list):
        res = super().create(vals_list)
        onchange_methods = self.env["res.partner.bank"]._onchange_methods
        if "acc_number" in onchange_methods:
            for partner in res:
                for account in partner.bank_ids:
                    for method in onchange_methods["acc_number"]:
                        method(account)
        return res

    # New methods after DnB
    @api.model
    def autocomplete_by_name(self, query, query_country_id, timeout=15):
        if (
            self.env.company.partner_autocomplete_provider
            == "partner.autocomplete.provider"
        ):
            return super().autocomplete_by_name(query, query_country_id, timeout)
        return self.env[self.env.company.partner_autocomplete_provider].autocomplete(
            query,
        )

    @api.model
    def autocomplete_by_vat(self, vat, query_country_id, timeout=15):
        if (
            self.env.company.partner_autocomplete_provider
            == "partner.autocomplete.provider"
        ):
            return super().autocomplete_by_vat(vat, query_country_id, timeout)
        return self.env[self.env.company.partner_autocomplete_provider].read_by_vat(
            vat,
        )

    @api.model
    def enrich_by_duns(self, duns, timeout=15):
        if (
            self.env.company.partner_autocomplete_provider
            == "partner.autocomplete.provider"
        ):
            return super().enrich_by_duns(duns, timeout)
        return self.env[self.env.company.partner_autocomplete_provider].enrich_company(
            None,
            duns,
            None,
        )
