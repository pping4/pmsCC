import { Prisma } from '@prisma/client';

declare global {
  namespace Prisma {
    interface RoomRateCreateInput {
      room: Prisma.RoomCreateNestedOneWithoutRateInput;
      dailyEnabled?: boolean;
      dailyRate?: Prisma.Decimal | number | string | null;
      monthlyShortEnabled?: boolean;
      monthlyShortRate?: Prisma.Decimal | number | string | null;
      monthlyShortFurniture?: Prisma.Decimal | number | string;
      monthlyShortMinMonths?: number;
      monthlyLongEnabled?: boolean;
      monthlyLongRate?: Prisma.Decimal | number | string | null;
      monthlyLongFurniture?: Prisma.Decimal | number | string;
      monthlyLongMinMonths?: number;
      waterRate?: Prisma.Decimal | number | string | null;
      electricRate?: Prisma.Decimal | number | string | null;
      updatedAt?: Date | string;
      updatedBy?: string | null;
    }

    interface RoomRateUncheckedCreateInput {
      id?: string;
      roomId: string;
      dailyEnabled?: boolean;
      dailyRate?: Prisma.Decimal | number | string | null;
      monthlyShortEnabled?: boolean;
      monthlyShortRate?: Prisma.Decimal | number | string | null;
      monthlyShortFurniture?: Prisma.Decimal | number | string;
      monthlyShortMinMonths?: number;
      monthlyLongEnabled?: boolean;
      monthlyLongRate?: Prisma.Decimal | number | string | null;
      monthlyLongFurniture?: Prisma.Decimal | number | string;
      monthlyLongMinMonths?: number;
      waterRate?: Prisma.Decimal | number | string | null;
      electricRate?: Prisma.Decimal | number | string | null;
      updatedAt?: Date | string;
      updatedBy?: string | null;
    }

    interface RoomRateUpdateInput {
      dailyEnabled?: boolean | Prisma.BoolFieldUpdateOperationsInput;
      dailyRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      monthlyShortEnabled?: boolean | Prisma.BoolFieldUpdateOperationsInput;
      monthlyShortRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      monthlyShortFurniture?: Prisma.Decimal | number | string | Prisma.DecimalFieldUpdateOperationsInput;
      monthlyShortMinMonths?: number | Prisma.IntFieldUpdateOperationsInput;
      monthlyLongEnabled?: boolean | Prisma.BoolFieldUpdateOperationsInput;
      monthlyLongRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      monthlyLongFurniture?: Prisma.Decimal | number | string | Prisma.DecimalFieldUpdateOperationsInput;
      monthlyLongMinMonths?: number | Prisma.IntFieldUpdateOperationsInput;
      waterRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      electricRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      updatedAt?: Date | string | Prisma.DateTimeFieldUpdateOperationsInput;
      updatedBy?: string | Prisma.NullableStringFieldUpdateOperationsInput | null;
      room?: Prisma.RoomUpdateOneRequiredWithoutRateNestedInput;
    }

    interface RoomRateUncheckedUpdateInput {
      id?: string | Prisma.StringFieldUpdateOperationsInput;
      roomId?: string | Prisma.StringFieldUpdateOperationsInput;
      dailyEnabled?: boolean | Prisma.BoolFieldUpdateOperationsInput;
      dailyRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      monthlyShortEnabled?: boolean | Prisma.BoolFieldUpdateOperationsInput;
      monthlyShortRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      monthlyShortFurniture?: Prisma.Decimal | number | string | Prisma.DecimalFieldUpdateOperationsInput;
      monthlyShortMinMonths?: number | Prisma.IntFieldUpdateOperationsInput;
      monthlyLongEnabled?: boolean | Prisma.BoolFieldUpdateOperationsInput;
      monthlyLongRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      monthlyLongFurniture?: Prisma.Decimal | number | string | Prisma.DecimalFieldUpdateOperationsInput;
      monthlyLongMinMonths?: number | Prisma.IntFieldUpdateOperationsInput;
      waterRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      electricRate?: Prisma.Decimal | number | string | Prisma.NullableDecimalFieldUpdateOperationsInput | null;
      updatedAt?: Date | string | Prisma.DateTimeFieldUpdateOperationsInput;
      updatedBy?: string | Prisma.NullableStringFieldUpdateOperationsInput | null;
    }

    interface RoomCreateNestedOneWithoutRateInput {
      create?: Prisma.RoomCreateWithoutRateInput;
      connectOrCreate?: Prisma.RoomCreateOrConnectWithoutRateInput;
      connect?: Prisma.RoomWhereUniqueInput;
    }

    interface RoomUpdateOneRequiredWithoutRateNestedInput {
      create?: Prisma.RoomCreateWithoutRateInput;
      connectOrCreate?: Prisma.RoomCreateOrConnectWithoutRateInput;
      upsert?: Prisma.RoomUpsertWithoutRateInput;
      connect?: Prisma.RoomWhereUniqueInput;
      update?: Prisma.RoomUpdateWithoutRateInput;
    }
  }
}

export {};
