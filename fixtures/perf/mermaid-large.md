# 大型 Mermaid 图(性能)

验证 change `mermaid-large-diagrams`:规模(语句数 + 连线数)超过阈值的图不自动渲染,显示占位里的提示与「渲染」按钮;点了才渲染一次。也是 `scripts/measure-mermaid-render.mjs` 的计时素材(每节一张图,节名是脚本里的名字)。

## (a) 400-edge graph TD

stress report bug 3 的写法(`N0[Node 0] --> N3`)的重建:原文档没留下,这里是 0–199 号节点各向后连 1 与 3,共 400 条边。

```mermaid
graph TD
  N0[Node 0] --> N1
  N0 --> N3
  N1[Node 1] --> N2
  N1 --> N4
  N2[Node 2] --> N3
  N2 --> N5
  N3[Node 3] --> N4
  N3 --> N6
  N4[Node 4] --> N5
  N4 --> N7
  N5[Node 5] --> N6
  N5 --> N8
  N6[Node 6] --> N7
  N6 --> N9
  N7[Node 7] --> N8
  N7 --> N10
  N8[Node 8] --> N9
  N8 --> N11
  N9[Node 9] --> N10
  N9 --> N12
  N10[Node 10] --> N11
  N10 --> N13
  N11[Node 11] --> N12
  N11 --> N14
  N12[Node 12] --> N13
  N12 --> N15
  N13[Node 13] --> N14
  N13 --> N16
  N14[Node 14] --> N15
  N14 --> N17
  N15[Node 15] --> N16
  N15 --> N18
  N16[Node 16] --> N17
  N16 --> N19
  N17[Node 17] --> N18
  N17 --> N20
  N18[Node 18] --> N19
  N18 --> N21
  N19[Node 19] --> N20
  N19 --> N22
  N20[Node 20] --> N21
  N20 --> N23
  N21[Node 21] --> N22
  N21 --> N24
  N22[Node 22] --> N23
  N22 --> N25
  N23[Node 23] --> N24
  N23 --> N26
  N24[Node 24] --> N25
  N24 --> N27
  N25[Node 25] --> N26
  N25 --> N28
  N26[Node 26] --> N27
  N26 --> N29
  N27[Node 27] --> N28
  N27 --> N30
  N28[Node 28] --> N29
  N28 --> N31
  N29[Node 29] --> N30
  N29 --> N32
  N30[Node 30] --> N31
  N30 --> N33
  N31[Node 31] --> N32
  N31 --> N34
  N32[Node 32] --> N33
  N32 --> N35
  N33[Node 33] --> N34
  N33 --> N36
  N34[Node 34] --> N35
  N34 --> N37
  N35[Node 35] --> N36
  N35 --> N38
  N36[Node 36] --> N37
  N36 --> N39
  N37[Node 37] --> N38
  N37 --> N40
  N38[Node 38] --> N39
  N38 --> N41
  N39[Node 39] --> N40
  N39 --> N42
  N40[Node 40] --> N41
  N40 --> N43
  N41[Node 41] --> N42
  N41 --> N44
  N42[Node 42] --> N43
  N42 --> N45
  N43[Node 43] --> N44
  N43 --> N46
  N44[Node 44] --> N45
  N44 --> N47
  N45[Node 45] --> N46
  N45 --> N48
  N46[Node 46] --> N47
  N46 --> N49
  N47[Node 47] --> N48
  N47 --> N50
  N48[Node 48] --> N49
  N48 --> N51
  N49[Node 49] --> N50
  N49 --> N52
  N50[Node 50] --> N51
  N50 --> N53
  N51[Node 51] --> N52
  N51 --> N54
  N52[Node 52] --> N53
  N52 --> N55
  N53[Node 53] --> N54
  N53 --> N56
  N54[Node 54] --> N55
  N54 --> N57
  N55[Node 55] --> N56
  N55 --> N58
  N56[Node 56] --> N57
  N56 --> N59
  N57[Node 57] --> N58
  N57 --> N60
  N58[Node 58] --> N59
  N58 --> N61
  N59[Node 59] --> N60
  N59 --> N62
  N60[Node 60] --> N61
  N60 --> N63
  N61[Node 61] --> N62
  N61 --> N64
  N62[Node 62] --> N63
  N62 --> N65
  N63[Node 63] --> N64
  N63 --> N66
  N64[Node 64] --> N65
  N64 --> N67
  N65[Node 65] --> N66
  N65 --> N68
  N66[Node 66] --> N67
  N66 --> N69
  N67[Node 67] --> N68
  N67 --> N70
  N68[Node 68] --> N69
  N68 --> N71
  N69[Node 69] --> N70
  N69 --> N72
  N70[Node 70] --> N71
  N70 --> N73
  N71[Node 71] --> N72
  N71 --> N74
  N72[Node 72] --> N73
  N72 --> N75
  N73[Node 73] --> N74
  N73 --> N76
  N74[Node 74] --> N75
  N74 --> N77
  N75[Node 75] --> N76
  N75 --> N78
  N76[Node 76] --> N77
  N76 --> N79
  N77[Node 77] --> N78
  N77 --> N80
  N78[Node 78] --> N79
  N78 --> N81
  N79[Node 79] --> N80
  N79 --> N82
  N80[Node 80] --> N81
  N80 --> N83
  N81[Node 81] --> N82
  N81 --> N84
  N82[Node 82] --> N83
  N82 --> N85
  N83[Node 83] --> N84
  N83 --> N86
  N84[Node 84] --> N85
  N84 --> N87
  N85[Node 85] --> N86
  N85 --> N88
  N86[Node 86] --> N87
  N86 --> N89
  N87[Node 87] --> N88
  N87 --> N90
  N88[Node 88] --> N89
  N88 --> N91
  N89[Node 89] --> N90
  N89 --> N92
  N90[Node 90] --> N91
  N90 --> N93
  N91[Node 91] --> N92
  N91 --> N94
  N92[Node 92] --> N93
  N92 --> N95
  N93[Node 93] --> N94
  N93 --> N96
  N94[Node 94] --> N95
  N94 --> N97
  N95[Node 95] --> N96
  N95 --> N98
  N96[Node 96] --> N97
  N96 --> N99
  N97[Node 97] --> N98
  N97 --> N100
  N98[Node 98] --> N99
  N98 --> N101
  N99[Node 99] --> N100
  N99 --> N102
  N100[Node 100] --> N101
  N100 --> N103
  N101[Node 101] --> N102
  N101 --> N104
  N102[Node 102] --> N103
  N102 --> N105
  N103[Node 103] --> N104
  N103 --> N106
  N104[Node 104] --> N105
  N104 --> N107
  N105[Node 105] --> N106
  N105 --> N108
  N106[Node 106] --> N107
  N106 --> N109
  N107[Node 107] --> N108
  N107 --> N110
  N108[Node 108] --> N109
  N108 --> N111
  N109[Node 109] --> N110
  N109 --> N112
  N110[Node 110] --> N111
  N110 --> N113
  N111[Node 111] --> N112
  N111 --> N114
  N112[Node 112] --> N113
  N112 --> N115
  N113[Node 113] --> N114
  N113 --> N116
  N114[Node 114] --> N115
  N114 --> N117
  N115[Node 115] --> N116
  N115 --> N118
  N116[Node 116] --> N117
  N116 --> N119
  N117[Node 117] --> N118
  N117 --> N120
  N118[Node 118] --> N119
  N118 --> N121
  N119[Node 119] --> N120
  N119 --> N122
  N120[Node 120] --> N121
  N120 --> N123
  N121[Node 121] --> N122
  N121 --> N124
  N122[Node 122] --> N123
  N122 --> N125
  N123[Node 123] --> N124
  N123 --> N126
  N124[Node 124] --> N125
  N124 --> N127
  N125[Node 125] --> N126
  N125 --> N128
  N126[Node 126] --> N127
  N126 --> N129
  N127[Node 127] --> N128
  N127 --> N130
  N128[Node 128] --> N129
  N128 --> N131
  N129[Node 129] --> N130
  N129 --> N132
  N130[Node 130] --> N131
  N130 --> N133
  N131[Node 131] --> N132
  N131 --> N134
  N132[Node 132] --> N133
  N132 --> N135
  N133[Node 133] --> N134
  N133 --> N136
  N134[Node 134] --> N135
  N134 --> N137
  N135[Node 135] --> N136
  N135 --> N138
  N136[Node 136] --> N137
  N136 --> N139
  N137[Node 137] --> N138
  N137 --> N140
  N138[Node 138] --> N139
  N138 --> N141
  N139[Node 139] --> N140
  N139 --> N142
  N140[Node 140] --> N141
  N140 --> N143
  N141[Node 141] --> N142
  N141 --> N144
  N142[Node 142] --> N143
  N142 --> N145
  N143[Node 143] --> N144
  N143 --> N146
  N144[Node 144] --> N145
  N144 --> N147
  N145[Node 145] --> N146
  N145 --> N148
  N146[Node 146] --> N147
  N146 --> N149
  N147[Node 147] --> N148
  N147 --> N150
  N148[Node 148] --> N149
  N148 --> N151
  N149[Node 149] --> N150
  N149 --> N152
  N150[Node 150] --> N151
  N150 --> N153
  N151[Node 151] --> N152
  N151 --> N154
  N152[Node 152] --> N153
  N152 --> N155
  N153[Node 153] --> N154
  N153 --> N156
  N154[Node 154] --> N155
  N154 --> N157
  N155[Node 155] --> N156
  N155 --> N158
  N156[Node 156] --> N157
  N156 --> N159
  N157[Node 157] --> N158
  N157 --> N160
  N158[Node 158] --> N159
  N158 --> N161
  N159[Node 159] --> N160
  N159 --> N162
  N160[Node 160] --> N161
  N160 --> N163
  N161[Node 161] --> N162
  N161 --> N164
  N162[Node 162] --> N163
  N162 --> N165
  N163[Node 163] --> N164
  N163 --> N166
  N164[Node 164] --> N165
  N164 --> N167
  N165[Node 165] --> N166
  N165 --> N168
  N166[Node 166] --> N167
  N166 --> N169
  N167[Node 167] --> N168
  N167 --> N170
  N168[Node 168] --> N169
  N168 --> N171
  N169[Node 169] --> N170
  N169 --> N172
  N170[Node 170] --> N171
  N170 --> N173
  N171[Node 171] --> N172
  N171 --> N174
  N172[Node 172] --> N173
  N172 --> N175
  N173[Node 173] --> N174
  N173 --> N176
  N174[Node 174] --> N175
  N174 --> N177
  N175[Node 175] --> N176
  N175 --> N178
  N176[Node 176] --> N177
  N176 --> N179
  N177[Node 177] --> N178
  N177 --> N180
  N178[Node 178] --> N179
  N178 --> N181
  N179[Node 179] --> N180
  N179 --> N182
  N180[Node 180] --> N181
  N180 --> N183
  N181[Node 181] --> N182
  N181 --> N184
  N182[Node 182] --> N183
  N182 --> N185
  N183[Node 183] --> N184
  N183 --> N186
  N184[Node 184] --> N185
  N184 --> N187
  N185[Node 185] --> N186
  N185 --> N188
  N186[Node 186] --> N187
  N186 --> N189
  N187[Node 187] --> N188
  N187 --> N190
  N188[Node 188] --> N189
  N188 --> N191
  N189[Node 189] --> N190
  N189 --> N192
  N190[Node 190] --> N191
  N190 --> N193
  N191[Node 191] --> N192
  N191 --> N194
  N192[Node 192] --> N193
  N192 --> N195
  N193[Node 193] --> N194
  N193 --> N196
  N194[Node 194] --> N195
  N194 --> N197
  N195[Node 195] --> N196
  N195 --> N198
  N196[Node 196] --> N197
  N196 --> N199
  N197[Node 197] --> N198
  N197 --> N200
  N198[Node 198] --> N199
  N198 --> N201
  N199[Node 199] --> N200
  N199 --> N202
```

## (b) 400-node flat graph TD

bug 8 的形状:一个根、三层、每层几百个节点(扁平而宽)。

```mermaid
graph TD
  R[Root]
  R --> M0[Group 0]
  R --> M1[Group 1]
  R --> M2[Group 2]
  R --> M3[Group 3]
  R --> M4[Group 4]
  R --> M5[Group 5]
  R --> M6[Group 6]
  R --> M7[Group 7]
  R --> M8[Group 8]
  R --> M9[Group 9]
  R --> M10[Group 10]
  R --> M11[Group 11]
  R --> M12[Group 12]
  R --> M13[Group 13]
  R --> M14[Group 14]
  R --> M15[Group 15]
  R --> M16[Group 16]
  R --> M17[Group 17]
  R --> M18[Group 18]
  R --> M19[Group 19]
  M0 --> L0_0[Leaf 0.0]
  M0 --> L0_1[Leaf 0.1]
  M0 --> L0_2[Leaf 0.2]
  M0 --> L0_3[Leaf 0.3]
  M0 --> L0_4[Leaf 0.4]
  M0 --> L0_5[Leaf 0.5]
  M0 --> L0_6[Leaf 0.6]
  M0 --> L0_7[Leaf 0.7]
  M0 --> L0_8[Leaf 0.8]
  M0 --> L0_9[Leaf 0.9]
  M0 --> L0_10[Leaf 0.10]
  M0 --> L0_11[Leaf 0.11]
  M0 --> L0_12[Leaf 0.12]
  M0 --> L0_13[Leaf 0.13]
  M0 --> L0_14[Leaf 0.14]
  M0 --> L0_15[Leaf 0.15]
  M0 --> L0_16[Leaf 0.16]
  M0 --> L0_17[Leaf 0.17]
  M0 --> L0_18[Leaf 0.18]
  M1 --> L1_0[Leaf 1.0]
  M1 --> L1_1[Leaf 1.1]
  M1 --> L1_2[Leaf 1.2]
  M1 --> L1_3[Leaf 1.3]
  M1 --> L1_4[Leaf 1.4]
  M1 --> L1_5[Leaf 1.5]
  M1 --> L1_6[Leaf 1.6]
  M1 --> L1_7[Leaf 1.7]
  M1 --> L1_8[Leaf 1.8]
  M1 --> L1_9[Leaf 1.9]
  M1 --> L1_10[Leaf 1.10]
  M1 --> L1_11[Leaf 1.11]
  M1 --> L1_12[Leaf 1.12]
  M1 --> L1_13[Leaf 1.13]
  M1 --> L1_14[Leaf 1.14]
  M1 --> L1_15[Leaf 1.15]
  M1 --> L1_16[Leaf 1.16]
  M1 --> L1_17[Leaf 1.17]
  M1 --> L1_18[Leaf 1.18]
  M2 --> L2_0[Leaf 2.0]
  M2 --> L2_1[Leaf 2.1]
  M2 --> L2_2[Leaf 2.2]
  M2 --> L2_3[Leaf 2.3]
  M2 --> L2_4[Leaf 2.4]
  M2 --> L2_5[Leaf 2.5]
  M2 --> L2_6[Leaf 2.6]
  M2 --> L2_7[Leaf 2.7]
  M2 --> L2_8[Leaf 2.8]
  M2 --> L2_9[Leaf 2.9]
  M2 --> L2_10[Leaf 2.10]
  M2 --> L2_11[Leaf 2.11]
  M2 --> L2_12[Leaf 2.12]
  M2 --> L2_13[Leaf 2.13]
  M2 --> L2_14[Leaf 2.14]
  M2 --> L2_15[Leaf 2.15]
  M2 --> L2_16[Leaf 2.16]
  M2 --> L2_17[Leaf 2.17]
  M2 --> L2_18[Leaf 2.18]
  M3 --> L3_0[Leaf 3.0]
  M3 --> L3_1[Leaf 3.1]
  M3 --> L3_2[Leaf 3.2]
  M3 --> L3_3[Leaf 3.3]
  M3 --> L3_4[Leaf 3.4]
  M3 --> L3_5[Leaf 3.5]
  M3 --> L3_6[Leaf 3.6]
  M3 --> L3_7[Leaf 3.7]
  M3 --> L3_8[Leaf 3.8]
  M3 --> L3_9[Leaf 3.9]
  M3 --> L3_10[Leaf 3.10]
  M3 --> L3_11[Leaf 3.11]
  M3 --> L3_12[Leaf 3.12]
  M3 --> L3_13[Leaf 3.13]
  M3 --> L3_14[Leaf 3.14]
  M3 --> L3_15[Leaf 3.15]
  M3 --> L3_16[Leaf 3.16]
  M3 --> L3_17[Leaf 3.17]
  M3 --> L3_18[Leaf 3.18]
  M4 --> L4_0[Leaf 4.0]
  M4 --> L4_1[Leaf 4.1]
  M4 --> L4_2[Leaf 4.2]
  M4 --> L4_3[Leaf 4.3]
  M4 --> L4_4[Leaf 4.4]
  M4 --> L4_5[Leaf 4.5]
  M4 --> L4_6[Leaf 4.6]
  M4 --> L4_7[Leaf 4.7]
  M4 --> L4_8[Leaf 4.8]
  M4 --> L4_9[Leaf 4.9]
  M4 --> L4_10[Leaf 4.10]
  M4 --> L4_11[Leaf 4.11]
  M4 --> L4_12[Leaf 4.12]
  M4 --> L4_13[Leaf 4.13]
  M4 --> L4_14[Leaf 4.14]
  M4 --> L4_15[Leaf 4.15]
  M4 --> L4_16[Leaf 4.16]
  M4 --> L4_17[Leaf 4.17]
  M4 --> L4_18[Leaf 4.18]
  M5 --> L5_0[Leaf 5.0]
  M5 --> L5_1[Leaf 5.1]
  M5 --> L5_2[Leaf 5.2]
  M5 --> L5_3[Leaf 5.3]
  M5 --> L5_4[Leaf 5.4]
  M5 --> L5_5[Leaf 5.5]
  M5 --> L5_6[Leaf 5.6]
  M5 --> L5_7[Leaf 5.7]
  M5 --> L5_8[Leaf 5.8]
  M5 --> L5_9[Leaf 5.9]
  M5 --> L5_10[Leaf 5.10]
  M5 --> L5_11[Leaf 5.11]
  M5 --> L5_12[Leaf 5.12]
  M5 --> L5_13[Leaf 5.13]
  M5 --> L5_14[Leaf 5.14]
  M5 --> L5_15[Leaf 5.15]
  M5 --> L5_16[Leaf 5.16]
  M5 --> L5_17[Leaf 5.17]
  M5 --> L5_18[Leaf 5.18]
  M6 --> L6_0[Leaf 6.0]
  M6 --> L6_1[Leaf 6.1]
  M6 --> L6_2[Leaf 6.2]
  M6 --> L6_3[Leaf 6.3]
  M6 --> L6_4[Leaf 6.4]
  M6 --> L6_5[Leaf 6.5]
  M6 --> L6_6[Leaf 6.6]
  M6 --> L6_7[Leaf 6.7]
  M6 --> L6_8[Leaf 6.8]
  M6 --> L6_9[Leaf 6.9]
  M6 --> L6_10[Leaf 6.10]
  M6 --> L6_11[Leaf 6.11]
  M6 --> L6_12[Leaf 6.12]
  M6 --> L6_13[Leaf 6.13]
  M6 --> L6_14[Leaf 6.14]
  M6 --> L6_15[Leaf 6.15]
  M6 --> L6_16[Leaf 6.16]
  M6 --> L6_17[Leaf 6.17]
  M6 --> L6_18[Leaf 6.18]
  M7 --> L7_0[Leaf 7.0]
  M7 --> L7_1[Leaf 7.1]
  M7 --> L7_2[Leaf 7.2]
  M7 --> L7_3[Leaf 7.3]
  M7 --> L7_4[Leaf 7.4]
  M7 --> L7_5[Leaf 7.5]
  M7 --> L7_6[Leaf 7.6]
  M7 --> L7_7[Leaf 7.7]
  M7 --> L7_8[Leaf 7.8]
  M7 --> L7_9[Leaf 7.9]
  M7 --> L7_10[Leaf 7.10]
  M7 --> L7_11[Leaf 7.11]
  M7 --> L7_12[Leaf 7.12]
  M7 --> L7_13[Leaf 7.13]
  M7 --> L7_14[Leaf 7.14]
  M7 --> L7_15[Leaf 7.15]
  M7 --> L7_16[Leaf 7.16]
  M7 --> L7_17[Leaf 7.17]
  M7 --> L7_18[Leaf 7.18]
  M8 --> L8_0[Leaf 8.0]
  M8 --> L8_1[Leaf 8.1]
  M8 --> L8_2[Leaf 8.2]
  M8 --> L8_3[Leaf 8.3]
  M8 --> L8_4[Leaf 8.4]
  M8 --> L8_5[Leaf 8.5]
  M8 --> L8_6[Leaf 8.6]
  M8 --> L8_7[Leaf 8.7]
  M8 --> L8_8[Leaf 8.8]
  M8 --> L8_9[Leaf 8.9]
  M8 --> L8_10[Leaf 8.10]
  M8 --> L8_11[Leaf 8.11]
  M8 --> L8_12[Leaf 8.12]
  M8 --> L8_13[Leaf 8.13]
  M8 --> L8_14[Leaf 8.14]
  M8 --> L8_15[Leaf 8.15]
  M8 --> L8_16[Leaf 8.16]
  M8 --> L8_17[Leaf 8.17]
  M8 --> L8_18[Leaf 8.18]
  M9 --> L9_0[Leaf 9.0]
  M9 --> L9_1[Leaf 9.1]
  M9 --> L9_2[Leaf 9.2]
  M9 --> L9_3[Leaf 9.3]
  M9 --> L9_4[Leaf 9.4]
  M9 --> L9_5[Leaf 9.5]
  M9 --> L9_6[Leaf 9.6]
  M9 --> L9_7[Leaf 9.7]
  M9 --> L9_8[Leaf 9.8]
  M9 --> L9_9[Leaf 9.9]
  M9 --> L9_10[Leaf 9.10]
  M9 --> L9_11[Leaf 9.11]
  M9 --> L9_12[Leaf 9.12]
  M9 --> L9_13[Leaf 9.13]
  M9 --> L9_14[Leaf 9.14]
  M9 --> L9_15[Leaf 9.15]
  M9 --> L9_16[Leaf 9.16]
  M9 --> L9_17[Leaf 9.17]
  M9 --> L9_18[Leaf 9.18]
  M10 --> L10_0[Leaf 10.0]
  M10 --> L10_1[Leaf 10.1]
  M10 --> L10_2[Leaf 10.2]
  M10 --> L10_3[Leaf 10.3]
  M10 --> L10_4[Leaf 10.4]
  M10 --> L10_5[Leaf 10.5]
  M10 --> L10_6[Leaf 10.6]
  M10 --> L10_7[Leaf 10.7]
  M10 --> L10_8[Leaf 10.8]
  M10 --> L10_9[Leaf 10.9]
  M10 --> L10_10[Leaf 10.10]
  M10 --> L10_11[Leaf 10.11]
  M10 --> L10_12[Leaf 10.12]
  M10 --> L10_13[Leaf 10.13]
  M10 --> L10_14[Leaf 10.14]
  M10 --> L10_15[Leaf 10.15]
  M10 --> L10_16[Leaf 10.16]
  M10 --> L10_17[Leaf 10.17]
  M10 --> L10_18[Leaf 10.18]
  M11 --> L11_0[Leaf 11.0]
  M11 --> L11_1[Leaf 11.1]
  M11 --> L11_2[Leaf 11.2]
  M11 --> L11_3[Leaf 11.3]
  M11 --> L11_4[Leaf 11.4]
  M11 --> L11_5[Leaf 11.5]
  M11 --> L11_6[Leaf 11.6]
  M11 --> L11_7[Leaf 11.7]
  M11 --> L11_8[Leaf 11.8]
  M11 --> L11_9[Leaf 11.9]
  M11 --> L11_10[Leaf 11.10]
  M11 --> L11_11[Leaf 11.11]
  M11 --> L11_12[Leaf 11.12]
  M11 --> L11_13[Leaf 11.13]
  M11 --> L11_14[Leaf 11.14]
  M11 --> L11_15[Leaf 11.15]
  M11 --> L11_16[Leaf 11.16]
  M11 --> L11_17[Leaf 11.17]
  M11 --> L11_18[Leaf 11.18]
  M12 --> L12_0[Leaf 12.0]
  M12 --> L12_1[Leaf 12.1]
  M12 --> L12_2[Leaf 12.2]
  M12 --> L12_3[Leaf 12.3]
  M12 --> L12_4[Leaf 12.4]
  M12 --> L12_5[Leaf 12.5]
  M12 --> L12_6[Leaf 12.6]
  M12 --> L12_7[Leaf 12.7]
  M12 --> L12_8[Leaf 12.8]
  M12 --> L12_9[Leaf 12.9]
  M12 --> L12_10[Leaf 12.10]
  M12 --> L12_11[Leaf 12.11]
  M12 --> L12_12[Leaf 12.12]
  M12 --> L12_13[Leaf 12.13]
  M12 --> L12_14[Leaf 12.14]
  M12 --> L12_15[Leaf 12.15]
  M12 --> L12_16[Leaf 12.16]
  M12 --> L12_17[Leaf 12.17]
  M12 --> L12_18[Leaf 12.18]
  M13 --> L13_0[Leaf 13.0]
  M13 --> L13_1[Leaf 13.1]
  M13 --> L13_2[Leaf 13.2]
  M13 --> L13_3[Leaf 13.3]
  M13 --> L13_4[Leaf 13.4]
  M13 --> L13_5[Leaf 13.5]
  M13 --> L13_6[Leaf 13.6]
  M13 --> L13_7[Leaf 13.7]
  M13 --> L13_8[Leaf 13.8]
  M13 --> L13_9[Leaf 13.9]
  M13 --> L13_10[Leaf 13.10]
  M13 --> L13_11[Leaf 13.11]
  M13 --> L13_12[Leaf 13.12]
  M13 --> L13_13[Leaf 13.13]
  M13 --> L13_14[Leaf 13.14]
  M13 --> L13_15[Leaf 13.15]
  M13 --> L13_16[Leaf 13.16]
  M13 --> L13_17[Leaf 13.17]
  M13 --> L13_18[Leaf 13.18]
  M14 --> L14_0[Leaf 14.0]
  M14 --> L14_1[Leaf 14.1]
  M14 --> L14_2[Leaf 14.2]
  M14 --> L14_3[Leaf 14.3]
  M14 --> L14_4[Leaf 14.4]
  M14 --> L14_5[Leaf 14.5]
  M14 --> L14_6[Leaf 14.6]
  M14 --> L14_7[Leaf 14.7]
  M14 --> L14_8[Leaf 14.8]
  M14 --> L14_9[Leaf 14.9]
  M14 --> L14_10[Leaf 14.10]
  M14 --> L14_11[Leaf 14.11]
  M14 --> L14_12[Leaf 14.12]
  M14 --> L14_13[Leaf 14.13]
  M14 --> L14_14[Leaf 14.14]
  M14 --> L14_15[Leaf 14.15]
  M14 --> L14_16[Leaf 14.16]
  M14 --> L14_17[Leaf 14.17]
  M14 --> L14_18[Leaf 14.18]
  M15 --> L15_0[Leaf 15.0]
  M15 --> L15_1[Leaf 15.1]
  M15 --> L15_2[Leaf 15.2]
  M15 --> L15_3[Leaf 15.3]
  M15 --> L15_4[Leaf 15.4]
  M15 --> L15_5[Leaf 15.5]
  M15 --> L15_6[Leaf 15.6]
  M15 --> L15_7[Leaf 15.7]
  M15 --> L15_8[Leaf 15.8]
  M15 --> L15_9[Leaf 15.9]
  M15 --> L15_10[Leaf 15.10]
  M15 --> L15_11[Leaf 15.11]
  M15 --> L15_12[Leaf 15.12]
  M15 --> L15_13[Leaf 15.13]
  M15 --> L15_14[Leaf 15.14]
  M15 --> L15_15[Leaf 15.15]
  M15 --> L15_16[Leaf 15.16]
  M15 --> L15_17[Leaf 15.17]
  M15 --> L15_18[Leaf 15.18]
  M16 --> L16_0[Leaf 16.0]
  M16 --> L16_1[Leaf 16.1]
  M16 --> L16_2[Leaf 16.2]
  M16 --> L16_3[Leaf 16.3]
  M16 --> L16_4[Leaf 16.4]
  M16 --> L16_5[Leaf 16.5]
  M16 --> L16_6[Leaf 16.6]
  M16 --> L16_7[Leaf 16.7]
  M16 --> L16_8[Leaf 16.8]
  M16 --> L16_9[Leaf 16.9]
  M16 --> L16_10[Leaf 16.10]
  M16 --> L16_11[Leaf 16.11]
  M16 --> L16_12[Leaf 16.12]
  M16 --> L16_13[Leaf 16.13]
  M16 --> L16_14[Leaf 16.14]
  M16 --> L16_15[Leaf 16.15]
  M16 --> L16_16[Leaf 16.16]
  M16 --> L16_17[Leaf 16.17]
  M16 --> L16_18[Leaf 16.18]
  M17 --> L17_0[Leaf 17.0]
  M17 --> L17_1[Leaf 17.1]
  M17 --> L17_2[Leaf 17.2]
  M17 --> L17_3[Leaf 17.3]
  M17 --> L17_4[Leaf 17.4]
  M17 --> L17_5[Leaf 17.5]
  M17 --> L17_6[Leaf 17.6]
  M17 --> L17_7[Leaf 17.7]
  M17 --> L17_8[Leaf 17.8]
  M17 --> L17_9[Leaf 17.9]
  M17 --> L17_10[Leaf 17.10]
  M17 --> L17_11[Leaf 17.11]
  M17 --> L17_12[Leaf 17.12]
  M17 --> L17_13[Leaf 17.13]
  M17 --> L17_14[Leaf 17.14]
  M17 --> L17_15[Leaf 17.15]
  M17 --> L17_16[Leaf 17.16]
  M17 --> L17_17[Leaf 17.17]
  M17 --> L17_18[Leaf 17.18]
  M18 --> L18_0[Leaf 18.0]
  M18 --> L18_1[Leaf 18.1]
  M18 --> L18_2[Leaf 18.2]
  M18 --> L18_3[Leaf 18.3]
  M18 --> L18_4[Leaf 18.4]
  M18 --> L18_5[Leaf 18.5]
  M18 --> L18_6[Leaf 18.6]
  M18 --> L18_7[Leaf 18.7]
  M18 --> L18_8[Leaf 18.8]
  M18 --> L18_9[Leaf 18.9]
  M18 --> L18_10[Leaf 18.10]
  M18 --> L18_11[Leaf 18.11]
  M18 --> L18_12[Leaf 18.12]
  M18 --> L18_13[Leaf 18.13]
  M18 --> L18_14[Leaf 18.14]
  M18 --> L18_15[Leaf 18.15]
  M18 --> L18_16[Leaf 18.16]
  M18 --> L18_17[Leaf 18.17]
  M18 --> L18_18[Leaf 18.18]
  M19 --> L19_0[Leaf 19.0]
  M19 --> L19_1[Leaf 19.1]
  M19 --> L19_2[Leaf 19.2]
  M19 --> L19_3[Leaf 19.3]
  M19 --> L19_4[Leaf 19.4]
  M19 --> L19_5[Leaf 19.5]
  M19 --> L19_6[Leaf 19.6]
  M19 --> L19_7[Leaf 19.7]
  M19 --> L19_8[Leaf 19.8]
  M19 --> L19_9[Leaf 19.9]
  M19 --> L19_10[Leaf 19.10]
  M19 --> L19_11[Leaf 19.11]
  M19 --> L19_12[Leaf 19.12]
  M19 --> L19_13[Leaf 19.13]
  M19 --> L19_14[Leaf 19.14]
  M19 --> L19_15[Leaf 19.15]
  M19 --> L19_16[Leaf 19.16]
  M19 --> L19_17[Leaf 19.17]
  M19 --> L19_18[Leaf 19.18]
```

## (c) 300-message sequenceDiagram

```mermaid
sequenceDiagram
  participant Alice
  participant Bob
  participant Carol
  participant Dave
  Alice->>Bob: message 0
  Bob->>Carol: message 1
  Carol->>Dave: message 2
  Dave->>Alice: message 3
  Alice->>Bob: message 4
  Bob->>Carol: message 5
  Carol->>Dave: message 6
  Dave->>Alice: message 7
  Alice->>Bob: message 8
  Bob->>Carol: message 9
  Carol->>Dave: message 10
  Dave->>Alice: message 11
  Alice->>Bob: message 12
  Bob->>Carol: message 13
  Carol->>Dave: message 14
  Dave->>Alice: message 15
  Alice->>Bob: message 16
  Bob->>Carol: message 17
  Carol->>Dave: message 18
  Dave->>Alice: message 19
  Alice->>Bob: message 20
  Bob->>Carol: message 21
  Carol->>Dave: message 22
  Dave->>Alice: message 23
  Alice->>Bob: message 24
  Bob->>Carol: message 25
  Carol->>Dave: message 26
  Dave->>Alice: message 27
  Alice->>Bob: message 28
  Bob->>Carol: message 29
  Carol->>Dave: message 30
  Dave->>Alice: message 31
  Alice->>Bob: message 32
  Bob->>Carol: message 33
  Carol->>Dave: message 34
  Dave->>Alice: message 35
  Alice->>Bob: message 36
  Bob->>Carol: message 37
  Carol->>Dave: message 38
  Dave->>Alice: message 39
  Alice->>Bob: message 40
  Bob->>Carol: message 41
  Carol->>Dave: message 42
  Dave->>Alice: message 43
  Alice->>Bob: message 44
  Bob->>Carol: message 45
  Carol->>Dave: message 46
  Dave->>Alice: message 47
  Alice->>Bob: message 48
  Bob->>Carol: message 49
  Carol->>Dave: message 50
  Dave->>Alice: message 51
  Alice->>Bob: message 52
  Bob->>Carol: message 53
  Carol->>Dave: message 54
  Dave->>Alice: message 55
  Alice->>Bob: message 56
  Bob->>Carol: message 57
  Carol->>Dave: message 58
  Dave->>Alice: message 59
  Alice->>Bob: message 60
  Bob->>Carol: message 61
  Carol->>Dave: message 62
  Dave->>Alice: message 63
  Alice->>Bob: message 64
  Bob->>Carol: message 65
  Carol->>Dave: message 66
  Dave->>Alice: message 67
  Alice->>Bob: message 68
  Bob->>Carol: message 69
  Carol->>Dave: message 70
  Dave->>Alice: message 71
  Alice->>Bob: message 72
  Bob->>Carol: message 73
  Carol->>Dave: message 74
  Dave->>Alice: message 75
  Alice->>Bob: message 76
  Bob->>Carol: message 77
  Carol->>Dave: message 78
  Dave->>Alice: message 79
  Alice->>Bob: message 80
  Bob->>Carol: message 81
  Carol->>Dave: message 82
  Dave->>Alice: message 83
  Alice->>Bob: message 84
  Bob->>Carol: message 85
  Carol->>Dave: message 86
  Dave->>Alice: message 87
  Alice->>Bob: message 88
  Bob->>Carol: message 89
  Carol->>Dave: message 90
  Dave->>Alice: message 91
  Alice->>Bob: message 92
  Bob->>Carol: message 93
  Carol->>Dave: message 94
  Dave->>Alice: message 95
  Alice->>Bob: message 96
  Bob->>Carol: message 97
  Carol->>Dave: message 98
  Dave->>Alice: message 99
  Alice->>Bob: message 100
  Bob->>Carol: message 101
  Carol->>Dave: message 102
  Dave->>Alice: message 103
  Alice->>Bob: message 104
  Bob->>Carol: message 105
  Carol->>Dave: message 106
  Dave->>Alice: message 107
  Alice->>Bob: message 108
  Bob->>Carol: message 109
  Carol->>Dave: message 110
  Dave->>Alice: message 111
  Alice->>Bob: message 112
  Bob->>Carol: message 113
  Carol->>Dave: message 114
  Dave->>Alice: message 115
  Alice->>Bob: message 116
  Bob->>Carol: message 117
  Carol->>Dave: message 118
  Dave->>Alice: message 119
  Alice->>Bob: message 120
  Bob->>Carol: message 121
  Carol->>Dave: message 122
  Dave->>Alice: message 123
  Alice->>Bob: message 124
  Bob->>Carol: message 125
  Carol->>Dave: message 126
  Dave->>Alice: message 127
  Alice->>Bob: message 128
  Bob->>Carol: message 129
  Carol->>Dave: message 130
  Dave->>Alice: message 131
  Alice->>Bob: message 132
  Bob->>Carol: message 133
  Carol->>Dave: message 134
  Dave->>Alice: message 135
  Alice->>Bob: message 136
  Bob->>Carol: message 137
  Carol->>Dave: message 138
  Dave->>Alice: message 139
  Alice->>Bob: message 140
  Bob->>Carol: message 141
  Carol->>Dave: message 142
  Dave->>Alice: message 143
  Alice->>Bob: message 144
  Bob->>Carol: message 145
  Carol->>Dave: message 146
  Dave->>Alice: message 147
  Alice->>Bob: message 148
  Bob->>Carol: message 149
  Carol->>Dave: message 150
  Dave->>Alice: message 151
  Alice->>Bob: message 152
  Bob->>Carol: message 153
  Carol->>Dave: message 154
  Dave->>Alice: message 155
  Alice->>Bob: message 156
  Bob->>Carol: message 157
  Carol->>Dave: message 158
  Dave->>Alice: message 159
  Alice->>Bob: message 160
  Bob->>Carol: message 161
  Carol->>Dave: message 162
  Dave->>Alice: message 163
  Alice->>Bob: message 164
  Bob->>Carol: message 165
  Carol->>Dave: message 166
  Dave->>Alice: message 167
  Alice->>Bob: message 168
  Bob->>Carol: message 169
  Carol->>Dave: message 170
  Dave->>Alice: message 171
  Alice->>Bob: message 172
  Bob->>Carol: message 173
  Carol->>Dave: message 174
  Dave->>Alice: message 175
  Alice->>Bob: message 176
  Bob->>Carol: message 177
  Carol->>Dave: message 178
  Dave->>Alice: message 179
  Alice->>Bob: message 180
  Bob->>Carol: message 181
  Carol->>Dave: message 182
  Dave->>Alice: message 183
  Alice->>Bob: message 184
  Bob->>Carol: message 185
  Carol->>Dave: message 186
  Dave->>Alice: message 187
  Alice->>Bob: message 188
  Bob->>Carol: message 189
  Carol->>Dave: message 190
  Dave->>Alice: message 191
  Alice->>Bob: message 192
  Bob->>Carol: message 193
  Carol->>Dave: message 194
  Dave->>Alice: message 195
  Alice->>Bob: message 196
  Bob->>Carol: message 197
  Carol->>Dave: message 198
  Dave->>Alice: message 199
  Alice->>Bob: message 200
  Bob->>Carol: message 201
  Carol->>Dave: message 202
  Dave->>Alice: message 203
  Alice->>Bob: message 204
  Bob->>Carol: message 205
  Carol->>Dave: message 206
  Dave->>Alice: message 207
  Alice->>Bob: message 208
  Bob->>Carol: message 209
  Carol->>Dave: message 210
  Dave->>Alice: message 211
  Alice->>Bob: message 212
  Bob->>Carol: message 213
  Carol->>Dave: message 214
  Dave->>Alice: message 215
  Alice->>Bob: message 216
  Bob->>Carol: message 217
  Carol->>Dave: message 218
  Dave->>Alice: message 219
  Alice->>Bob: message 220
  Bob->>Carol: message 221
  Carol->>Dave: message 222
  Dave->>Alice: message 223
  Alice->>Bob: message 224
  Bob->>Carol: message 225
  Carol->>Dave: message 226
  Dave->>Alice: message 227
  Alice->>Bob: message 228
  Bob->>Carol: message 229
  Carol->>Dave: message 230
  Dave->>Alice: message 231
  Alice->>Bob: message 232
  Bob->>Carol: message 233
  Carol->>Dave: message 234
  Dave->>Alice: message 235
  Alice->>Bob: message 236
  Bob->>Carol: message 237
  Carol->>Dave: message 238
  Dave->>Alice: message 239
  Alice->>Bob: message 240
  Bob->>Carol: message 241
  Carol->>Dave: message 242
  Dave->>Alice: message 243
  Alice->>Bob: message 244
  Bob->>Carol: message 245
  Carol->>Dave: message 246
  Dave->>Alice: message 247
  Alice->>Bob: message 248
  Bob->>Carol: message 249
  Carol->>Dave: message 250
  Dave->>Alice: message 251
  Alice->>Bob: message 252
  Bob->>Carol: message 253
  Carol->>Dave: message 254
  Dave->>Alice: message 255
  Alice->>Bob: message 256
  Bob->>Carol: message 257
  Carol->>Dave: message 258
  Dave->>Alice: message 259
  Alice->>Bob: message 260
  Bob->>Carol: message 261
  Carol->>Dave: message 262
  Dave->>Alice: message 263
  Alice->>Bob: message 264
  Bob->>Carol: message 265
  Carol->>Dave: message 266
  Dave->>Alice: message 267
  Alice->>Bob: message 268
  Bob->>Carol: message 269
  Carol->>Dave: message 270
  Dave->>Alice: message 271
  Alice->>Bob: message 272
  Bob->>Carol: message 273
  Carol->>Dave: message 274
  Dave->>Alice: message 275
  Alice->>Bob: message 276
  Bob->>Carol: message 277
  Carol->>Dave: message 278
  Dave->>Alice: message 279
  Alice->>Bob: message 280
  Bob->>Carol: message 281
  Carol->>Dave: message 282
  Dave->>Alice: message 283
  Alice->>Bob: message 284
  Bob->>Carol: message 285
  Carol->>Dave: message 286
  Dave->>Alice: message 287
  Alice->>Bob: message 288
  Bob->>Carol: message 289
  Carol->>Dave: message 290
  Dave->>Alice: message 291
  Alice->>Bob: message 292
  Bob->>Carol: message 293
  Carol->>Dave: message 294
  Dave->>Alice: message 295
  Alice->>Bob: message 296
  Bob->>Carol: message 297
  Carol->>Dave: message 298
  Dave->>Alice: message 299
```

## (d) just under the threshold

规模 290(145 条边的链),略低于阈值 `LARGE_DIAGRAM_SIZE` = 300:打开就渲染,不出提示;实测最长任务约 0.9 s(前台 Chrome,`scripts/measure-mermaid-render.mjs`)。

```mermaid
graph TD
  N0[Node 0] --> N1
  N1[Node 1] --> N2
  N2[Node 2] --> N3
  N3[Node 3] --> N4
  N4[Node 4] --> N5
  N5[Node 5] --> N6
  N6[Node 6] --> N7
  N7[Node 7] --> N8
  N8[Node 8] --> N9
  N9[Node 9] --> N10
  N10[Node 10] --> N11
  N11[Node 11] --> N12
  N12[Node 12] --> N13
  N13[Node 13] --> N14
  N14[Node 14] --> N15
  N15[Node 15] --> N16
  N16[Node 16] --> N17
  N17[Node 17] --> N18
  N18[Node 18] --> N19
  N19[Node 19] --> N20
  N20[Node 20] --> N21
  N21[Node 21] --> N22
  N22[Node 22] --> N23
  N23[Node 23] --> N24
  N24[Node 24] --> N25
  N25[Node 25] --> N26
  N26[Node 26] --> N27
  N27[Node 27] --> N28
  N28[Node 28] --> N29
  N29[Node 29] --> N30
  N30[Node 30] --> N31
  N31[Node 31] --> N32
  N32[Node 32] --> N33
  N33[Node 33] --> N34
  N34[Node 34] --> N35
  N35[Node 35] --> N36
  N36[Node 36] --> N37
  N37[Node 37] --> N38
  N38[Node 38] --> N39
  N39[Node 39] --> N40
  N40[Node 40] --> N41
  N41[Node 41] --> N42
  N42[Node 42] --> N43
  N43[Node 43] --> N44
  N44[Node 44] --> N45
  N45[Node 45] --> N46
  N46[Node 46] --> N47
  N47[Node 47] --> N48
  N48[Node 48] --> N49
  N49[Node 49] --> N50
  N50[Node 50] --> N51
  N51[Node 51] --> N52
  N52[Node 52] --> N53
  N53[Node 53] --> N54
  N54[Node 54] --> N55
  N55[Node 55] --> N56
  N56[Node 56] --> N57
  N57[Node 57] --> N58
  N58[Node 58] --> N59
  N59[Node 59] --> N60
  N60[Node 60] --> N61
  N61[Node 61] --> N62
  N62[Node 62] --> N63
  N63[Node 63] --> N64
  N64[Node 64] --> N65
  N65[Node 65] --> N66
  N66[Node 66] --> N67
  N67[Node 67] --> N68
  N68[Node 68] --> N69
  N69[Node 69] --> N70
  N70[Node 70] --> N71
  N71[Node 71] --> N72
  N72[Node 72] --> N73
  N73[Node 73] --> N74
  N74[Node 74] --> N75
  N75[Node 75] --> N76
  N76[Node 76] --> N77
  N77[Node 77] --> N78
  N78[Node 78] --> N79
  N79[Node 79] --> N80
  N80[Node 80] --> N81
  N81[Node 81] --> N82
  N82[Node 82] --> N83
  N83[Node 83] --> N84
  N84[Node 84] --> N85
  N85[Node 85] --> N86
  N86[Node 86] --> N87
  N87[Node 87] --> N88
  N88[Node 88] --> N89
  N89[Node 89] --> N90
  N90[Node 90] --> N91
  N91[Node 91] --> N92
  N92[Node 92] --> N93
  N93[Node 93] --> N94
  N94[Node 94] --> N95
  N95[Node 95] --> N96
  N96[Node 96] --> N97
  N97[Node 97] --> N98
  N98[Node 98] --> N99
  N99[Node 99] --> N100
  N100[Node 100] --> N101
  N101[Node 101] --> N102
  N102[Node 102] --> N103
  N103[Node 103] --> N104
  N104[Node 104] --> N105
  N105[Node 105] --> N106
  N106[Node 106] --> N107
  N107[Node 107] --> N108
  N108[Node 108] --> N109
  N109[Node 109] --> N110
  N110[Node 110] --> N111
  N111[Node 111] --> N112
  N112[Node 112] --> N113
  N113[Node 113] --> N114
  N114[Node 114] --> N115
  N115[Node 115] --> N116
  N116[Node 116] --> N117
  N117[Node 117] --> N118
  N118[Node 118] --> N119
  N119[Node 119] --> N120
  N120[Node 120] --> N121
  N121[Node 121] --> N122
  N122[Node 122] --> N123
  N123[Node 123] --> N124
  N124[Node 124] --> N125
  N125[Node 125] --> N126
  N126[Node 126] --> N127
  N127[Node 127] --> N128
  N128[Node 128] --> N129
  N129[Node 129] --> N130
  N130[Node 130] --> N131
  N131[Node 131] --> N132
  N132[Node 132] --> N133
  N133[Node 133] --> N134
  N134[Node 134] --> N135
  N135[Node 135] --> N136
  N136[Node 136] --> N137
  N137[Node 137] --> N138
  N138[Node 138] --> N139
  N139[Node 139] --> N140
  N140[Node 140] --> N141
  N141[Node 141] --> N142
  N142[Node 142] --> N143
  N143[Node 143] --> N144
  N144[Node 144] --> N145
```
