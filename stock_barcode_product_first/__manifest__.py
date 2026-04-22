{
    'name': "Barcode Picking: Product-First Sorting",
    'summary': "Groups barcode picking lines by product instead of by location",
    'description': """
Changes the barcode picking interface to display lines grouped by product first,
then by source location within each product group. This way, the picker completes
all locations for Product A before moving on to Product B.
    """,
    'category': 'Supply Chain/Inventory',
    'version': '19.0.1.0.0',
    'depends': ['stock_barcode'],
    'author': 'Data Dance s.r.o.',
    'license': 'LGPL-3',
    'assets': {
        'web.assets_backend': [
            'stock_barcode_product_first/static/src/**/*.js',
            'stock_barcode_product_first/static/src/**/*.xml',
        ],
    },
    'installable': True,
    'auto_install': False,
}
