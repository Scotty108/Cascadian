INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xc7f7edb333f5cbd8a3146805e21602984b852abf', 1.9112084469377555, 115.87003300629158, 588912.3154709999, 1000, 518, 216, 0.7057220708446866, '2025-10-26T18:32:57.561Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x3a03c6dd168a7a24864c4df17bf4dd06be09a0b7', 18.309793656166747, 39.13631530449626, 492016.013385, 255, 123, 2, 0.984, '2025-10-26T18:32:57.981Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xb744f56635b537e859152d14b022af5afe485210', 735.919212787203, 193961.72816244836, 664281.517334, 68, 18, 5, 0.782608695652174, '2025-10-26T18:32:58.241Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xe27b3674cfccb0cc87426d421ee3faaceb9168d2', 1.4182399869904248, 233.7018824915596, 300546.320998, 352, 170, 3, 0.9826589595375722, '2025-10-26T18:32:58.531Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xd199709b1e8cc374cf1d6100f074f15fc04ea5f2', 22.233390139741118, 894.0015802989449, 263347.262399, 218, 102, 6, 0.9444444444444444, '2025-10-26T18:32:58.811Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xe5ddd343733a26f42b635ec805661bfce60c7ff2', 36.14991430309876, 915.4164348673328, 233787.728596, 226, 100, 12, 0.8928571428571429, '2025-10-26T18:32:59.079Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x54cab817c0c96b4ab37220f20016d006aa38b424', 258.16527269942816, 810.7019312079397, 216200.480399, 205, 101, 3, 0.9711538461538461, '2025-10-26T18:32:59.352Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x19da5bf0ae47a580fe2f0cd8992fe7ecad8df2df', 3.775882177700349, 24.069009131488908, 213379.877797, 128, 54, 6, 0.9, '2025-10-26T18:32:59.736Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xa0eec49a78de470cbda7818a6bc71b566175d37b', 289.0821567728487, 866.5542129472277, 212570.9056, 189, 74, 6, 0.925, '2025-10-26T18:33:00.037Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xa38ccedaf59ed4dd73efb3f0fc8c27caa65addd2', 19.282606263547024, 933.3615315070355, 203905.8744, 225, 107, 5, 0.9553571428571429, '2025-10-26T18:33:00.523Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xddb609546dc3b87fa537fd5b9fea7c781f7ff951', 209.36226932975092, 800.0919460116768, 196451.01479800002, 216, 105, 1, 0.9905660377358491, '2025-10-26T18:33:00.835Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xcc3489b51f9708143967f5f8b48fb282a7e42fe0', 172.8867321775201, 804.7037590163068, 192955.466, 124, 51, 7, 0.8793103448275862, '2025-10-26T18:33:01.211Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xf9beae61d2c8fa74f42610f23d6178c12a77281c', 29.035621007129492, 871.5403448666531, 173982.114997, 241, 107, 12, 0.8991596638655462, '2025-10-26T18:33:01.639Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xac2223502b43845dea344006cf14757913350ba2', 190.84659893246976, 811.0915791660058, 138391.16458799999, 138, 58, 3, 0.9508196721311475, '2025-10-26T18:33:01.900Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xb1c7e6c0209b1f6a6ed04ba6b9f4fe73fa544cdc', 102.43834262956729, 1226.3647236006316, 138321.025791, 306, 147, 3, 0.98, '2025-10-26T18:33:02.179Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x34600abd7059cb89590ffa6037cef7058341fdc1', 3194.972357748613, 799.0764039003315, 136349.342798, 107, 52, 1, 0.9811320754716981, '2025-10-26T18:33:02.395Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x4c7c7808fe125e9a4133c9dbfe2757b83036a2c8', 245.11980015068823, 1096.3200459973261, 132764.783799, 143, 70, 2, 0.9722222222222222, '2025-10-26T18:33:02.652Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x897d9ba96822913c6049fabd143a7972b1f282de', 88.38353882204953, 819.2583328423931, 130246.275799, 243, 118, 2, 0.9833333333333333, '2025-10-26T18:33:02.917Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xfa1991cd8082174eedce066381c6565d6fbd4f3c', 16.607135746234242, 35903.0839636251, 124101.21463, 34, 11, 1, 0.9166666666666666, '2025-10-26T18:33:03.145Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xe5b44088fda3afcc5758bdaef971cee7a9b2d923', 78.01441980625503, 1207.729987990846, 121418.045199, 357, 145, 13, 0.9177215189873418, '2025-10-26T18:33:03.479Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x0f35e91675de4a860a58ff46cd3b56d90e5f3888', 34.513559089992114, 805.5366387208363, 117414.42239, 249, 121, 4, 0.968, '2025-10-26T18:33:03.751Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x5ef1940a85e78fcd2379fa3d476a8b958b866319', 116.91212670549984, 815.2994808873179, 112039.371992, 209, 99, 4, 0.9611650485436893, '2025-10-26T18:33:04.003Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xe9c0e434546dcae7322aefa2fee664d7dc6333fc', 536.0640672628651, 1313.0168466529203, 109664.042799, 245, 118, 2, 0.9833333333333333, '2025-10-26T18:33:04.285Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x0a6a2c321023526986adb45338d7b44cd8d7a759', 188.18125742712354, 850.9320698041527, 106742.896789, 254, 122, 4, 0.9682539682539683, '2025-10-26T18:33:04.567Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x4f4aba236f9909a628aa0cfda09943dba8821b76', 30.5444919286897, 816.719445010914, 103757.027398, 224, 108, 3, 0.972972972972973, '2025-10-26T18:33:04.836Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x45715d53d1f3d1d6ffcc7a579037b0bcf9b2ea35', 226.25734144897962, 833.6626206391287, 102095.971999, 201, 96, 1, 0.9896907216494846, '2025-10-26T18:33:05.080Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xc5c61ef3d22da66081faa94a81ff9689e63075f2', 160.78634273372646, 817.0487615465373, 100202.64979499999, 137, 61, 8, 0.8840579710144928, '2025-10-26T18:33:05.344Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x765de6f83bac6918832cb0d0f475d924b418a4e9', 332.70433124049384, 793.4859451355372, 100034.526993, 206, 90, 3, 0.967741935483871, '2025-10-26T18:33:05.722Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xe7dc88025638527ab2dccaa0d024a2eb38b0f785', 107.69526645554113, 838.7224969977115, 93852.11099999999, 190, 78, 7, 0.9176470588235294, '2025-10-26T18:33:06.126Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x8a5681eaadab8ff042d43d5aec9f62cc9d2c6623', 578.0429751417265, 882.6562211950242, 92018.93919800001, 159, 53, 1, 0.9814814814814815, '2025-10-26T18:33:06.446Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x543cc8faa8ddafff89d27dc2df6869931c8e0819', 266.3599875669882, 834.5181282335969, 89874.140799, 162, 70, 6, 0.9210526315789473, '2025-10-26T18:33:06.773Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x0e587f57dacc3e9eb997860d925be55a15058165', 22.88965937049004, 863.1924486589777, 86413.102597, 124, 54, 3, 0.9473684210526315, '2025-10-26T18:33:07.204Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xd254b6a6b90450c438ecb92b264c3590d93576e4', 298.316112304041, 825.069087379814, 84382.014997, 206, 98, 3, 0.9702970297029703, '2025-10-26T18:33:07.619Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xc56278319d1d16c52e16d56608cf24f4bfe036c3', 192.83768541435063, 820.6700527949606, 82743.088398, 137, 64, 3, 0.9552238805970149, '2025-10-26T18:33:07.940Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xfc11bcc3459411a5eba5467cb7f9e17e0ae22aef', 419.1971573187152, 810.2355374285305, 79288.3214, 109, 41, 2, 0.9534883720930233, '2025-10-26T18:33:08.243Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x7b1eefeeea7e97ac65db0ac14ee4f31316761e52', 133.49361558100242, 798.9705362578267, 74563.536994, 99, 34, 1, 0.9714285714285714, '2025-10-26T18:33:08.524Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x4df685a9e98ca0a95ce54982b1ac7a036d52ded4', 525.0490381172852, 844.635687882839, 70831.21560000001, 204, 97, 1, 0.9897959183673469, '2025-10-26T18:33:08.785Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x50d81c2c7427a6ae4b349a23268a1484b079ca43', 60.7044861172023, 1547.3995902537029, 67852.023999, 173, 66, 5, 0.9295774647887324, '2025-10-26T18:33:09.106Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x4162c6e2b41195f11d3413abf8269a07b1ad9619', 71.80897195024082, 837.460565563184, 66219.426598, 214, 100, 6, 0.9433962264150944, '2025-10-26T18:33:09.381Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x389d200ff824b1d6c8ba11983b4b8f4aea8a6365', 697.3022748614577, 841.9821173120642, 64784.281795999996, 208, 94, 5, 0.9494949494949495, '2025-10-26T18:33:09.653Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xafbee8983d642ae9b81f8f221ed6402c7bcc8715', 0.3366333996148851, -110.68011759907552, 62987.791335, 14, 6, 4, 0.6, '2025-10-26T18:33:09.870Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x880a79edb93a4d49cf04b2c50b017c7213d33877', 99, 841.2291228030423, 62289.952997, 199, 95, 0, 1, '2025-10-26T18:33:10.130Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xcc84895775897542833d28e48a4202a4d3b3c643', 24.495885466105786, 879.0359343348514, 62059.444797, 178, 68, 10, 0.8717948717948718, '2025-10-26T18:33:10.490Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x57cd404102315fcfae7be17848f9d393d049b6a9', 241.50839790801263, 840.7030004758344, 61300.861999, 169, 55, 3, 0.9482758620689655, '2025-10-26T18:33:10.839Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x9dc1a3bef22da1c552d292036c564f65a4e5afa9', 155.47433677696247, 798.7360320697286, 61021.619596000004, 52, 23, 2, 0.92, '2025-10-26T18:33:11.131Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x3ed7344d1e9df0ced4706c6800603cee226de617', 41.455712474867795, 35310.945093996175, 59853.163992, 69, 28, 1, 0.9655172413793104, '2025-10-26T18:33:11.353Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x02f2209baf4ce4a2269b31ffb0b4ca9117e01ba6', 100.95870649000099, 792.2739654378054, 56385.951396000004, 124, 55, 4, 0.9322033898305084, '2025-10-26T18:33:11.760Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x848d617c80823c887dfd236237769dd7dad3da63', 132.57723778451503, 810.8301116322631, 52354.651599000004, 136, 55, 10, 0.8461538461538461, '2025-10-26T18:33:12.124Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0x759b08ec1f779efd31eef03c88a719182cf52ab3', 41.930258813046756, 8326.046806773466, 52130.909017, 45, 18, 2, 0.9, '2025-10-26T18:33:12.461Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;

INSERT INTO wallet_scores (wallet_address, omega_net, total_pnl, total_volume_usd, total_bets, wins, losses, win_rate, last_calculated_at)
VALUES ('0xc4d825958e69037fd3e324272b2f538e73d582b1', 176.79988167780354, 794.5577057228528, 50015.7444, 121, 54, 1, 0.9818181818181818, '2025-10-26T18:33:12.920Z')
ON CONFLICT (wallet_address) DO UPDATE SET
  omega_net = EXCLUDED.omega_net,
  total_pnl = EXCLUDED.total_pnl,
  total_volume_usd = EXCLUDED.total_volume_usd,
  total_bets = EXCLUDED.total_bets,
  wins = EXCLUDED.wins,
  losses = EXCLUDED.losses,
  win_rate = EXCLUDED.win_rate,
  last_calculated_at = EXCLUDED.last_calculated_at;