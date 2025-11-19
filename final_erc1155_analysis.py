#!/usr/bin/env python3
import json

# Data collected from TypeScript analysis
erc1155_data = {
    "wallet_cluster": {
        "eoa": "0xcce2b7c71f21e358b8e5e797e586cbc03160d58b",
        "proxy": "0xd59d03eeb0fd5979c702ba20bcc25da2ae1d9723",
        "type": "Safe (proxy wallet)"
    },
    "erc1155_transfers": {
        "total": 249,
        "direction_breakdown": {
            "to_eoa": 180,
            "from_eoa": 69
        },
        "time_range": {
            "earliest": "2024-08-21 17:57:45",
            "latest": "2025-10-30 20:58:09"
        },
        "monthly_breakdown": {
            "2024-08": 22,
            "2024-09": 78,
            "2024-10": 39,
            "2024-11": 22,
            "2024-12": 14,
            "2025-01": 9,
            "2025-02": 10,
            "2025-03": 6,
            "2025-04": 3,
            "2025-05": 1,
            "2025-06": 0,
            "2025-07": 0,
            "2025-08": 0,
            "2025-09": 38,
            "2025-10": 7
        }
    },
    "canonical_trades": {
        "count": "UNKNOWN",
        "total_usd_value": "UNKNOWN"
    },
    "polymarket_ui_volume": 1383851.59,
    "pnl_v2_canonical_volume": 225572.34,
    "sample_transfers": [
        {
            "timestamp": "2025-10-30 20:58:09",
            "direction": "OUTBOUND",
            "tx_hash": "0xabffebff511763210395f59ba99ab3f186ca1ca973c333b4cf0d6803328217cb",
            "value_hex": "0x12560fb0"
        },
        {
            "timestamp": "2025-10-15 00:38:45",
            "direction": "INBOUND",
            "tx_hash": "0xd3ea4e87ebd74eb8c38df371e83fc9c90d3326c942d3831e88232ca971b47f65",
            "value_hex": "0x3b9aca00"
        }
    ]
}

print(json.dumps(erc1155_data, indent=2))
